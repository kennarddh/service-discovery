import dgram from 'node:dgram'
import crypto, { UUID } from 'node:crypto'

import { TypedEmitter } from 'tiny-typed-emitter'

import IsValidJson from './Utils/IsValidJson.js'
import SetImmediateInterval from './Utils/SetImmediateInterval.js'

import {
	IAllPacket,
	IAllPacketBody,
	ICheckPeerTimeouts,
	IEvents,
	IHandshake,
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
} from './Types.js'

class ServiceDiscovery<Data> extends TypedEmitter<IEvents<Data>> {
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

	public constructor({
		host = '224.0.0.114',
		port = 60540,
		ttl = 1,
		announceInterval = 2000,
		peerAnnounceTimeout = 4000,
		shouldAcceptDataBeforeAnnounce = false,
		acknowledgementTimeout = 3000,
		maxRetry = 3,
	}: Partial<IOptions> = {}) {
		super()

		this.host = host
		this.port = port
		this.ttl = ttl

		this.announceInterval = announceInterval
		this.shouldAcceptDataBeforeAnnounce = shouldAcceptDataBeforeAnnounce

		this.peerAnnounceTimeout = peerAnnounceTimeout

		this.acknowledgementTimeout = acknowledgementTimeout
		this.maxRetry = maxRetry
	}

	public listen(handshake: IHandshake = {}) {
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

	private sendRawPacket(data: IAllPacket<Data>) {
		return new Promise<void>(resolve => {
			if (!this.isListening)
				throw new Error('Socket is not currently listening')

			const message = JSON.stringify(data)

			this.socket.send(message, this.port, this.host, () => resolve())
		})
	}

	private sendPacket(
		data: IAllPacketBody<Data>,
		targetIds: UUID[] | '*',
		sendAcknowledgement: boolean = true
	) {
		return new Promise<void>(resolve => {
			const packetId = crypto.randomUUID()

			const sendData: IPacketData<Data> = {
				type: IPacketType.Data,
				id: packetId,
				body: data,
				sender: {
					id: this.id,
				},
				targetIds,
			}

			if (sendAcknowledgement) {
				this.pendingAcknowledgements[packetId] = {
					pendingTarget: this.knownPeers.map(peer => peer.id),
					intervalId: setInterval(() => {
						this.pendingAcknowledgements[
							packetId
						].remainingRetry -= 1

						this.sendRawPacket({
							...sendData,
							targetIds:
								this.pendingAcknowledgements[packetId]
									.pendingTarget,
						})

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
				this.sendRawPacket(sendData)
			} else this.sendRawPacket(sendData).then(() => resolve())
		})
	}

	private async send(send: IPacketBody) {
		await this.sendPacket(send, '*', send.type !== IPacketBodyType.Announce)
	}

	public async sendData(data: Data) {
		const sendData: IPacketBodyData<Data> = {
			type: IPacketBodyType.Data,
			data,
		}

		await this.sendPacket(sendData, '*')
	}

	private sendAcknowledgement(packetId: UUID, sender: IPeer) {
		this.sendRawPacket({
			type: IPacketType.Acknowledgement,
			targetIds: [sender.id],
			acknowledgedId: packetId,
			sender: {
				id: this.id,
			},
		})
	}

	private parseMessage(message: Buffer, remoteInfo: dgram.RemoteInfo) {
		const messageString = message.toString()

		const [isValid, data] = IsValidJson<IAllPacket<Data>>(messageString)

		if (!isValid) return // Ignore invalid messages

		if (data.sender.id === this.id) return // Ignore this instance message

		if (!(data.targetIds === '*' || data.targetIds.includes(this.id)))
			return // Ignore message if not targeted

		if (data.type === IPacketType.Acknowledgement) {
			// Remove receiver from pending array
			this.removeReceiverFromPendingAcknowledgement(
				data.acknowledgedId,
				data.sender
			)
		} else {
			if (this.isClosing) return

			if (data.body.type === IPacketBodyType.Announce) {
				if (!this.isPeerIdKnown(data.sender.id)) {
					this.knownPeers.push(data.sender)

					this.emit('newPeer', {
						remoteInfo,
						handshake: data.body.data.handshake,
						sender: data.sender,
					})
				}

				if (this.checkPeerTimeouts[data.sender.id]) {
					clearTimeout(this.checkPeerTimeouts[data.sender.id])
				}

				this.checkPeerTimeouts[data.sender.id] = setTimeout(() => {
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
					if (!this.isPeerIdKnown(data.sender.id)) return // Peer is not known

					this.removePeer({ remoteInfo, sender: data.sender })

					if (this.checkPeerTimeouts[data.sender.id]) {
						clearTimeout(this.checkPeerTimeouts[data.sender.id])

						delete this.checkPeerTimeouts[data.sender.id]
					}
				} else if (data.body.type === IPacketBodyType.Data) {
					if (
						this.shouldAcceptDataBeforeAnnounce ||
						this.isPeerIdKnown(data.sender.id)
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
		sender: IPeer
	) {
		if (!this.pendingAcknowledgements[acknowledgedId]) return

		this.pendingAcknowledgements[acknowledgedId].pendingTarget =
			this.pendingAcknowledgements[acknowledgedId].pendingTarget.filter(
				target => target !== sender.id
			)

		if (
			this.pendingAcknowledgements[acknowledgedId].pendingTarget
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
		sender: IPeer
	}) {
		this.knownPeers = this.knownPeers.filter(peer => peer.id !== sender.id)

		for (const packetId of Object.keys(
			this.pendingAcknowledgements
		) as UUID[]) {
			this.removeReceiverFromPendingAcknowledgement(packetId, sender)
		}

		this.emit('peerRemoved', {
			remoteInfo,
			sender: sender,
		})
	}
}

export default ServiceDiscovery
