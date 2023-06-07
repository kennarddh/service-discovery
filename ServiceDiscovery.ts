import dgram from 'node:dgram'
import crypto from 'node:crypto'

import { TypedEmitter } from 'tiny-typed-emitter'

import IsValidJson from './IsValidJson.js'
import SetImmediateInterval from './SetImmediateInterval.js'

interface IEvents<Data> {
	start: (data: { socket: dgram.Socket }) => void
	close: () => void
	error: (error: Error) => void
	data: (data: { data: Data; sender: IPeer }) => void
	newPeer: (data: {
		remoteInfo: dgram.RemoteInfo
		handshake: IHandshake
		sender: IPeer
	}) => void
	peerRemoved: (data: { remoteInfo: dgram.RemoteInfo; sender: IPeer }) => void
}

export enum IInstanceType {
	Server,
	Client,
}

interface IPeer {
	id: crypto.UUID
	type: IInstanceType
}

interface ISendBase {}

enum ISendType {
	Announce,
	Close,
	Data,
}

interface ISendAnnounce extends ISendBase {
	type: ISendType.Announce
	data: {
		handshake: IHandshake
	}
}

interface ISendClose extends ISendBase {
	type: ISendType.Close
}

interface ISendData<T> extends ISendBase {
	type: ISendType.Data
	data: T
}

type ISend = ISendAnnounce | ISendClose

type IAllSend<Data> = ISendData<Data> | ISend

enum IPacketType {
	Acknowledgement,
	Data,
}

interface IPacketData<Data> {
	type: IPacketType.Data
	id: string
	data: IAllSend<Data>
	sender: IPeer
	targetIds: crypto.UUID[] | '*'
}

interface IPacketAcknowledgement {
	type: IPacketType.Acknowledgement
	acknowledgedId: string
	sender: IPeer
	targetIds: string[]
}

type IAllPacket<Data> = IPacketAcknowledgement | IPacketData<Data>

type IHandshake = Record<string, any>

interface IOptions {
	host: string
	port: number
	ttl: number

	announceInterval: number
	shouldAcceptDataBeforeAnnounce: boolean

	peerAnnounceTimeout: number

	clientOptions: Partial<IClientOptions>
	serverOptions: Partial<IServerOptions>
}

interface IServerOptions {}

interface IClientOptions {}

class ServiceDiscovery<Data> extends TypedEmitter<IEvents<Data>> {
	private socket: dgram.Socket
	private host: string
	private port: number

	private ttl: number

	private instanceId: crypto.UUID

	private announceIntervalId: NodeJS.Timer
	private announceInterval: number

	private checkPeerTimeouts: Record<string, NodeJS.Timer> = {}
	private peerAnnounceTimeout: number

	private knownPeer: IPeer[] = []

	private internalIsListening: boolean
	private instanceType: IInstanceType

	private clientOptions: IClientOptions
	private serverOptions: IServerOptions

	private shouldAcceptDataBeforeAnnounce: boolean

	public constructor({
		host = '224.0.0.114',
		port = 60540,
		ttl = 1,
		announceInterval = 2000,
		peerAnnounceTimeout = 4000,
		shouldAcceptDataBeforeAnnounce = false,
		serverOptions = {},
		clientOptions = {},
	}: Partial<IOptions> = {}) {
		super()

		this.host = host
		this.port = port
		this.ttl = ttl

		this.announceInterval = announceInterval
		this.shouldAcceptDataBeforeAnnounce = shouldAcceptDataBeforeAnnounce

		this.peerAnnounceTimeout = peerAnnounceTimeout

		this.serverOptions = serverOptions as IServerOptions
		this.clientOptions = clientOptions as IClientOptions
	}

	public listen(isServer: boolean, handshake: IHandshake = {}) {
		this.isListening = true
		this.instanceType = isServer
			? IInstanceType.Server
			: IInstanceType.Client

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
				this.send({
					type: ISendType.Announce,
					data: {
						handshake,
					},
				})
			}, this.announceInterval)
		})
	}

	public listenClient(handshake: IHandshake = {}) {
		this.listen(false, handshake)
	}

	public listenServer(handshake: IHandshake = {}) {
		this.listen(true, handshake)
	}

	public close(error: Error = undefined) {
		const next = () => {
			clearInterval(this.announceIntervalId)

			if (this.isListening && !error) this.socket.close()

			this.announceIntervalId = null

			this.socket = null

			this.isListening = false
			this.instanceType = null

			this.instanceId = null

			this.knownPeer = []

			if (error) this.emit('error', error)

			this.emit('close')
		}

		if (this.isListening && !error) {
			this.send({ type: ISendType.Close }, next)
		} else {
			next()
		}
	}

	public get id() {
		return this.instanceId
	}

	public get isServer(): boolean {
		return this.instanceType === IInstanceType.Server
	}

	public get isClient(): boolean {
		return this.instanceType === IInstanceType.Client
	}

	public get isListening(): boolean {
		return this.internalIsListening
	}

	private set isListening(value) {
		this.internalIsListening = value
	}

	private sendRawPacket(data: IAllPacket<Data>, callback?: () => void) {
		if (!this.isListening)
			throw new Error('Socket is not currently listening')

		const message = JSON.stringify(data)

		this.socket.send(message, this.port, this.host, callback)
	}

	private sendPacket(data: IAllSend<Data>, callback?: () => void) {
		const packetId = crypto.randomUUID()

		const sendData: IPacketData<Data> = {
			type: IPacketType.Data,
			id: packetId,
			data: data,
			sender: {
				id: this.id,
				type: this.instanceType,
			},
			targetIds: '*',
		}

		this.sendRawPacket(sendData, callback)
	}

	private send(send: ISend, callback?: () => void) {
		this.sendPacket(send, callback)
	}

	public sendData(data: Data, callback?: () => void) {
		const sendData: ISendData<Data> = {
			type: ISendType.Data,
			data,
		}

		this.sendPacket(sendData, callback)
	}

	private parseMessage(message: Buffer, remoteInfo: dgram.RemoteInfo) {
		const messageString = message.toString()

		const [isValid, data] = IsValidJson<IAllPacket<Data>>(messageString)

		if (!isValid) return // Ignore invalid messages

		if (data.sender.id === this.id) return // Ignore this instance message

		if (!(data.targetIds === '*' || data.targetIds.includes(this.id)))
			return // Ignore message if not targeted

		if (data.type === IPacketType.Acknowledgement)
			return // TODO Will be handled later
		else {
			if (data.data.type === ISendType.Announce) {
				if (!this.isPeerIdKnown(data.sender.id)) {
					this.knownPeer.push(data.sender)

					this.emit('newPeer', {
						remoteInfo,
						handshake: data.data.data.handshake,
						sender: data.sender,
					})
				}

				if (this.checkPeerTimeouts[data.sender.id]) {
					clearTimeout(this.checkPeerTimeouts[data.sender.id])
				}

				this.checkPeerTimeouts[data.sender.id] = setTimeout(() => {
					this.removePeer(data.sender.id)

					this.emit('peerRemoved', {
						remoteInfo,
						sender: data.sender,
					})
				}, this.peerAnnounceTimeout)
			} else if (data.data.type === ISendType.Close) {
				if (!this.isPeerIdKnown(data.sender.id)) return // Peer is not known

				this.removePeer(data.sender.id)

				if (this.checkPeerTimeouts[data.sender.id]) {
					clearTimeout(this.checkPeerTimeouts[data.sender.id])

					delete this.checkPeerTimeouts[data.sender.id]
				}

				this.emit('peerRemoved', {
					remoteInfo,
					sender: data.sender,
				})
			} else if (data.data.type === ISendType.Data) {
				if (
					this.shouldAcceptDataBeforeAnnounce ||
					this.isPeerIdKnown(data.sender.id)
				)
					this.emit('data', {
						data: data.data.data as Data,
						sender: data.sender,
					})
			}
		}
	}

	private getPeerById(id: string): IPeer | null {
		return this.knownPeer.find(peer => peer.id === id)
	}

	private isPeerIdKnown(id: string): boolean {
		return !!this.getPeerById(id)
	}

	private removePeer(id: string) {
		this.knownPeer = this.knownPeer.filter(peer => peer.id !== id)
	}
}

export default ServiceDiscovery
