import dgram from 'node:dgram'
import crypto from 'node:crypto'

import { TypedEmitter } from 'tiny-typed-emitter'

import IsValidJson from './IsValidJson.js'
import SetImmediateInterval from './SetImmediateInterval.js'

interface IEvents {
	start: (data: { socket: dgram.Socket }) => void
	close: () => void
	error: (error: Error) => void
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
	id: string
	type: IInstanceType
}

interface ISendBase {
	sender: IPeer
}

interface ISendAnnounce extends ISendBase {
	type: 'announce'
	data: {
		handshake: IHandshake
	}
}

interface ISendClose extends ISendBase {
	type: 'close'
}

interface ISendData<T> extends ISendBase {
	type: 'data'
	data: T
}

type ISend = ISendAnnounce | ISendClose

type IHandshake = Record<string, any>

interface IOptions {
	host: string
	port: number
	ttl: number

	announceInterval: number
	shouldAcceptDataBeforeAnnounce: boolean

	clientOptions: Partial<IClientOptions>
	serverOptions: Partial<IServerOptions>
}

interface IServerOptions {}

interface IClientOptions {}

class ServiceDiscovery<Data> extends TypedEmitter<
	IEvents & {
		data: (data: { data: Data; sender: IPeer }) => void
	}
> {
	private socket: dgram.Socket
	private host: string
	private port: number

	private ttl: number

	private instanceId: string

	private announceIntervalId: NodeJS.Timer
	private announceInterval: number

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
		this.serverOptions = serverOptions as IServerOptions
		this.clientOptions = clientOptions as IClientOptions
	}

	public listen(isServer: true, handshake?: IHandshake): void
	public listen(isServer: false): void

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
					type: 'announce',
					data: {
						handshake,
					},
					sender: {
						id: this.id,
						type: this.instanceType,
					},
				})
			}, this.announceInterval)
		})
	}

	public listenClient() {
		this.listen(false)
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
			this.send(
				{
					type: 'close',
					sender: {
						id: this.id,
						type: this.instanceType,
					},
				},
				next
			)
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

	private rawSend(message: string, callback?: () => void) {
		if (!this.isListening)
			throw new Error('Socket is not currently listening')

		this.socket.send(message, this.port, this.host, callback)
	}

	private send(send: ISend, callback?: () => void) {
		this.rawSend(JSON.stringify(send), callback)
	}

	public sendData(data: Data, callback?: () => void) {
		const sendData: ISendData<Data> = {
			type: 'data',
			data,
			sender: {
				id: this.id,
				type: this.instanceType,
			},
		}

		this.rawSend(JSON.stringify(sendData), callback)
	}

	private parseMessage(message: Buffer, remoteInfo: dgram.RemoteInfo) {
		const messageString = message.toString()

		const [isValid, data] = IsValidJson<ISendData<Data> | ISend>(
			messageString
		)

		if (!isValid) return // Ignore invalid messages

		if (data.sender.id === this.id) return // Ignore this instance message

		if (data.type === 'announce') {
			if (this.isPeerIdKnown(data.sender.id)) return // Peer is already known

			this.knownPeer.push(data.sender)

			this.emit('newPeer', {
				remoteInfo,
				handshake: data.data.handshake,
				sender: data.sender,
			})
		} else if (data.type === 'close') {
			if (!this.isPeerIdKnown(data.sender.id)) return // Peer is not known

			this.removePeer(data.sender.id)

			this.emit('peerRemoved', {
				remoteInfo,
				sender: data.sender,
			})
		} else if (data.type === 'data') {
			if (
				this.shouldAcceptDataBeforeAnnounce ||
				this.isPeerIdKnown(data.sender.id)
			)
				this.emit('data', {
					data: data.data as Data,
					sender: data.sender,
				})
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
