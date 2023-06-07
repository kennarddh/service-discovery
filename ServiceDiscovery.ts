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
}

export enum IInstanceType {
	Client,
	Server,
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

interface ISendData<T> extends ISendBase {
	type: 'data'
	data: T
}

type ISend = ISendAnnounce

type IHandshake = Record<string, any>

interface IOptions {
	host: string
	port: number

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
		announceInterval = 2000,
		shouldAcceptDataBeforeAnnounce = false,
		serverOptions = {},
		clientOptions = {},
	}: Partial<IOptions> = {}) {
		super()

		this.host = host
		this.port = port
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
			this.socket.setMulticastTTL(1)

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

	public close(error: Error = undefined) {
		clearInterval(this.announceIntervalId)

		this.socket.close()

		this.announceIntervalId = null

		this.socket = null

		this.isListening = false
		this.instanceType = null

		this.instanceId = null

		if (error) this.emit('error', error)

		this.emit('close')
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

	private rawSend(message: string) {
		this.socket.send(message, this.port, this.host)
	}

	private send(send: ISend) {
		this.rawSend(JSON.stringify(send))
	}

	public sendData(data: Data) {
		const sendData: ISendData<Data> = {
			type: 'data',
			data,
			sender: {
				id: this.id,
				type: this.instanceType,
			},
		}

		this.rawSend(JSON.stringify(sendData))
	}

	private parseMessage(message: Buffer, remoteInfo: dgram.RemoteInfo) {
		const messageString = message.toString()

		const [isValid, data] = IsValidJson<ISendData<Data> | ISend>(
			messageString
		)

		if (!isValid) return // Ignore invalid messages

		if (data.sender.id === this.id) return // Ignore this instance message

		if (data.type === 'announce') {
			if (this.isPeerIdKnown(data.sender.id)) return // Service already known

			this.knownPeer.push(data.sender)

			this.emit('newPeer', {
				remoteInfo,
				handshake: data.data.handshake,
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
}

export default ServiceDiscovery
