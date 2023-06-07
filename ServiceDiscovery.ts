import dgram from 'node:dgram'
import crypto from 'node:crypto'

import { TypedEmitter } from 'tiny-typed-emitter'

import IsValidJson from './IsValidJson.js'
import SetImmediateInterval from './SetImmediateInterval.js'

interface IEvents {
	start: (data: {
		socket: dgram.Socket
		isServer: boolean
		isClient: boolean
	}) => void
	close: () => void
	error: (error: Error) => void
	newService: (data: {
		remoteInfo: dgram.RemoteInfo
		handshake: IHandshake
		sender: ISender
	}) => void
}

interface ISender {
	id: string
}

interface ISendBase {
	sender: ISender
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

class ServiceDiscovery<Data> extends TypedEmitter<
	IEvents & {
		data: (data: { data: Data; sender: ISender }) => void
	}
> {
	private socket: dgram.Socket
	private host: string
	private port: number

	private instanceId: string

	private announceInterval: number
	private announceIntervalId: NodeJS.Timer

	private knownServices: string[] = []

	private isServer: boolean
	private isClient: boolean
	private isListening: boolean

	public constructor({
		host = '224.0.0.114',
		port = 60540,
		announceInterval = 2000,
	} = {}) {
		super()

		this.host = host
		this.port = port
		this.announceInterval = announceInterval
	}

	public listen(isServer: true, handshake?: IHandshake): void
	public listen(isServer: false): void

	public listen(isServer: boolean, handshake: IHandshake = {}) {
		this.isListening = true
		this.isServer = isServer
		this.isClient = !isServer

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
				isServer: this.isServer,
				isClient: this.isClient,
			})
		})

		this.socket.bind(this.port, () => {
			this.socket.addMembership(this.host)

			this.socket.setMulticastLoopback(true)
			this.socket.setMulticastTTL(1)

			this.instanceId = crypto.randomUUID()

			if (this.isServer) {
				this.announceIntervalId = SetImmediateInterval(() => {
					this.send({
						type: 'announce',
						data: {
							handshake,
						},
						sender: {
							id: this.id,
						},
					})
				}, this.announceInterval)
			}
		})
	}

	public close(error: Error = undefined) {
		clearInterval(this.announceIntervalId)

		this.socket.close()

		this.announceIntervalId = null

		this.socket = null

		this.isListening = false
		this.isServer = false
		this.isClient = false

		this.instanceId = null

		if (error) this.emit('error', error)

		this.emit('close')
	}

	public get id() {
		return this.instanceId
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
			if (this.knownServices.includes(data.sender.id)) return // Service already known

			this.knownServices.push(data.sender.id)

			this.emit('newService', {
				remoteInfo,
				handshake: data.data.handshake,
				sender: data.sender,
			})
		} else if (data.type === 'data') {
			this.emit('data', { data: data.data as Data, sender: data.sender })
		}
	}
}

export default ServiceDiscovery
