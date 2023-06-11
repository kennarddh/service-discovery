import dgram from 'node:dgram'
import crypto, { UUID } from 'node:crypto'

import { TypedEmitter } from 'tiny-typed-emitter'

import SetImmediateInterval from './Utils/SetImmediateInterval.js'

import IParser from './Parser/Types.js'

import {
	IAllPacket,
	IAllPacketBody,
	ICheckPeerTimeouts,
	IEvents,
	IInternalEvents,
	IKnownPackets,
	IOptions,
	IPacketBody,
	IPacketBodyData,
	IPacketBodyType,
	IPacketData,
	IPacketType,
	IPeer,
	IPendingAcknowledgements,
	ISender,
	IReceivers,
} from './Types.js'

class ServiceDiscovery<Handshake, Data> extends TypedEmitter<
	IEvents<Handshake, Data>
> {
	private socket: dgram.Socket
	private host: string
	private port: number

	private ttl: number

	private instanceId: UUID

	private announceIntervalId: NodeJS.Timer
	private announceInterval: number

	private checkPeerTimeouts: ICheckPeerTimeouts = {}
	private peerAnnounceTimeout: number

	private knownPeers: IPeer[] = []

	private internalIsListening: boolean

	private isClosing: boolean

	private shouldAcceptDataBeforeAnnounce: boolean

	private acknowledgementTimeout: number
	private pendingAcknowledgements: IPendingAcknowledgements = {}

	private knownPackets: IKnownPackets = {}

	private maxRetry: number

	private internalEvent: TypedEmitter<IInternalEvents> = new TypedEmitter()

	private parser: IParser<Handshake, Data>

	public constructor({
		host = '224.0.0.114',
		port = 60540,
		ttl = 1,
		announceInterval = 2000,
		peerAnnounceTimeout = 4000,
		shouldAcceptDataBeforeAnnounce = false,
		acknowledgementTimeout = 3000,
		maxRetry = 3,
		parser,
	}: IOptions<Handshake, Data>) {
		super()

		this.host = host
		this.port = port
		this.ttl = ttl

		this.announceInterval = announceInterval
		this.shouldAcceptDataBeforeAnnounce = shouldAcceptDataBeforeAnnounce

		this.peerAnnounceTimeout = peerAnnounceTimeout

		this.acknowledgementTimeout = acknowledgementTimeout
		this.maxRetry = maxRetry

		this.parser = parser
	}

	public listen(handshake: Handshake) {
		if (this.isListening) throw new Error('Socket already listening')

		this.isListening = true

		this.instanceId = crypto.randomUUID()

		this.socket = dgram.createSocket({
			type: 'udp4',
			reuseAddr: true,
		})

		this.socket.on('error', error => {
			this.close(error)
		})

		this.socket.on('message', (message, remoteInfo) =>
			this.parseMessage(message, remoteInfo)
		)

		this.socket.on('listening', () => {
			this.emit('start', {
				socket: this.socket,
			})
		})

		this.socket.bind(this.port, () => {
			this.socket.addMembership(this.host)

			this.socket.setMulticastLoopback(true)
			this.socket.setMulticastTTL(this.ttl)

			this.announceIntervalId = SetImmediateInterval(() => {
				if (!this.isClosing)
					this.send({
						type: IPacketBodyType.Announce,
						data: {
							handshake,
						},
					})
			}, this.announceInterval)
		})
	}

	public async close(error: Error = undefined) {
		if (!this.isListening) throw new Error('Socket is not listening')

		this.isClosing = true

		clearInterval(this.announceIntervalId)

		this.announceIntervalId = null

		if (!error) {
			await this.send({ type: IPacketBodyType.Close })

			await new Promise<void>(resolve => this.socket.close(resolve))
		}

		for (const timeout of Object.values(this.checkPeerTimeouts)) {
			clearTimeout(timeout)
		}

		this.checkPeerTimeouts = {}

		for (const pending of Object.values(this.pendingAcknowledgements)) {
			clearInterval(pending.intervalId)
		}

		this.pendingAcknowledgements = {}

		this.socket = null

		this.isListening = false

		this.instanceId = null

		this.knownPeers = []

		for (const packet of Object.values(this.knownPackets)) {
			clearTimeout(packet.timeoutId)
		}

		this.knownPackets = {}

		this.isClosing = false

		if (error) this.emit('error', error)

		this.emit('close')
	}

	public get id() {
		return this.instanceId
	}

	public get isListening(): boolean {
		return this.internalIsListening
	}

	private set isListening(value) {
		this.internalIsListening = value
	}

	private sendRawPacket(
		data: IAllPacket<Handshake, Data>,
		receivers: IReceivers = '*'
	) {
		if (!this.isListening)
			throw new Error('Socket is not currently listening')

		return new Promise<void>(resolve => {
			const message = this.parser.serializePacket(data)

			if (receivers === '*')
				this.socket.send(message, this.port, this.host, () => resolve())
			else {
				Promise.all(
					receivers.map(
						receiver =>
							new Promise<void>(resolve => {
								const host = this.getPeerById(receiver).host

								this.socket.send(message, this.port, host, () =>
									resolve()
								)
							})
					)
				).then(() => resolve())
			}
		})
	}

	private sendPacket(
		data: IAllPacketBody<Handshake, Data>,
		receivers: UUID[] | '*',
		sendAcknowledgement: boolean = true
	) {
		return new Promise<void>(resolve => {
			const packetId = crypto.randomUUID()

			const sendData: IPacketData<Handshake, Data> = {
				type: IPacketType.Data,
				id: packetId,
				body: data,
				sender: this.id,
			}

			if (sendAcknowledgement) {
				this.pendingAcknowledgements[packetId] = {
					pendingReceivers: this.knownPeers.map(peer => peer.id),
					intervalId: setInterval(() => {
						// On retry
						this.pendingAcknowledgements[
							packetId
						].remainingRetry -= 1

						this.sendRawPacket(
							sendData,
							this.pendingAcknowledgements[packetId]
								.pendingReceivers
						)

						if (
							this.pendingAcknowledgements[packetId]
								.remainingRetry === 0
						) {
							clearInterval(
								this.pendingAcknowledgements[packetId]
									.intervalId
							)

							this.internalEvent.off(
								'acknowledgementReceivedAll',
								onAckReceivedAll
							)

							resolve()

							delete this.pendingAcknowledgements[packetId]
						}
					}, this.acknowledgementTimeout),
					remainingRetry: this.maxRetry,
				}

				const onAckReceivedAll = ({
					packetId: receivedPacketId,
				}: {
					packetId: UUID
				}) => {
					if (receivedPacketId !== packetId) return

					this.internalEvent.off(
						'acknowledgementReceivedAll',
						onAckReceivedAll
					)

					resolve()
				}

				this.internalEvent.on(
					'acknowledgementReceivedAll',
					onAckReceivedAll
				)
				this.sendRawPacket(sendData, receivers)
			} else this.sendRawPacket(sendData, receivers).then(() => resolve())
		})
	}

	private async send(send: IPacketBody<Handshake>) {
		await this.sendPacket(send, '*', send.type !== IPacketBodyType.Announce)
	}

	public async sendData(data: Data) {
		const sendData: IPacketBodyData<Data> = {
			type: IPacketBodyType.Data,
			data,
		}

		await this.sendPacket(sendData, '*')
	}

	private sendAcknowledgement(packetId: UUID, sender: ISender) {
		this.sendRawPacket(
			{
				type: IPacketType.Acknowledgement,
				acknowledgedId: packetId,
				sender: this.id,
			},
			[sender]
		)
	}

	private parseMessage(message: Buffer, remoteInfo: dgram.RemoteInfo) {
		const [isValid, data] = this.parser.isValidPacket(message)

		if (!isValid) return // Ignore invalid packet

		if (data.sender === this.id) return // Ignore this instance packet

		if (data.type === IPacketType.Acknowledgement) {
			// Remove receiver from pending array
			this.removeReceiverFromPendingAcknowledgement(
				data.acknowledgedId,
				data.sender
			)
		} else {
			if (this.isClosing) return

			if (data.body.type === IPacketBodyType.Announce) {
				if (!this.isPeerIdKnown(data.sender)) {
					this.knownPeers.push({
						id: data.sender,
						host: remoteInfo.address,
						port: remoteInfo.port,
					})

					this.emit('newPeer', {
						remoteInfo,
						handshake: data.body.data.handshake,
						peer: this.getPeerById(data.sender),
					})
				}

				if (this.checkPeerTimeouts[data.sender]) {
					clearTimeout(this.checkPeerTimeouts[data.sender])
				}

				this.checkPeerTimeouts[data.sender] = setTimeout(() => {
					this.removePeer({ remoteInfo, sender: data.sender })
				}, this.peerAnnounceTimeout)
			} else {
				this.sendAcknowledgement(data.id, data.sender)

				if (this.knownPackets[data.id]) return // Data already parsed

				this.knownPackets[data.id] = {
					timeoutId: setTimeout(() => {
						delete this.knownPackets[data.id]
					}, this.maxRetry * this.acknowledgementTimeout * 2),
				}

				if (data.body.type === IPacketBodyType.Close) {
					if (!this.isPeerIdKnown(data.sender)) return // Peer is not known

					this.removePeer({ remoteInfo, sender: data.sender })

					if (this.checkPeerTimeouts[data.sender]) {
						clearTimeout(this.checkPeerTimeouts[data.sender])

						delete this.checkPeerTimeouts[data.sender]
					}
				} else if (data.body.type === IPacketBodyType.Data) {
					if (
						this.shouldAcceptDataBeforeAnnounce ||
						this.isPeerIdKnown(data.sender)
					) {
						this.emit('data', {
							data: data.body.data as Data,
							sender: data.sender,
						})
					}
				}
			}
		}
	}

	private getPeerById(id: string): IPeer | null {
		return this.knownPeers.find(peer => peer.id === id)
	}

	private isPeerIdKnown(id: string): boolean {
		return !!this.getPeerById(id)
	}

	private removeReceiverFromPendingAcknowledgement(
		acknowledgedId: UUID,
		sender: ISender
	) {
		if (!this.pendingAcknowledgements[acknowledgedId]) return

		this.pendingAcknowledgements[acknowledgedId].pendingReceivers =
			this.pendingAcknowledgements[
				acknowledgedId
			].pendingReceivers.filter(receiver => receiver !== sender)

		if (
			this.pendingAcknowledgements[acknowledgedId].pendingReceivers
				.length === 0
		) {
			clearInterval(
				this.pendingAcknowledgements[acknowledgedId].intervalId
			)

			delete this.pendingAcknowledgements[acknowledgedId]

			this.internalEvent.emit('acknowledgementReceivedAll', {
				packetId: acknowledgedId,
			})
		}
	}

	private removePeer({
		remoteInfo,
		sender,
	}: {
		remoteInfo: dgram.RemoteInfo
		sender: ISender
	}) {
		this.knownPeers = this.knownPeers.filter(peer => peer.id !== sender)

		for (const packetId of Object.keys(
			this.pendingAcknowledgements
		) as UUID[]) {
			this.removeReceiverFromPendingAcknowledgement(packetId, sender)
		}

		this.emit('peerRemoved', {
			remoteInfo,
			peer: this.getPeerById(sender),
		})
	}
}

export default ServiceDiscovery
