import dgram from 'node:dgram'
import crypto from 'node:crypto'

import { TypedEmitter } from 'tiny-typed-emitter'

import IsValidJson from './IsValidJson.js'

interface IEvents {
	start: (socket: dgram.Socket) => void
	close: () => void
	error: (error: Error) => void
	newService: (remoteInfo: dgram.RemoteInfo, handshake: IHandshake) => void
}

type ISendAnnounce = {
	type: 'announce'
	data: {
		id: string
		handshake: IHandshake
	}
}

type ISendData<T> = {
	type: 'data'
	data: T
}

type ISend = ISendAnnounce

type IHandshake = Record<string, any>

class ServiceDiscovery<Data> extends TypedEmitter<
	IEvents & {
		data: (data: Data) => void
	}
> {
	private socket: dgram.Socket
	private host: string
	private port: number

	private instaceId: string

	private announceIntervalDelay: number
	private announceInterval: NodeJS.Timer

	public constructor({
		host = '224.0.0.114',
		port = 60540,
		announceIntervalDelay = 2000,
	} = {}) {
		super()

		this.host = host
		this.port = port
		this.announceIntervalDelay = announceIntervalDelay
	}

	public listen(handshake: IHandshake = {}) {
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
			this.emit('start', this.socket)
		})

		this.socket.bind(this.port, () => {
			this.socket.addMembership(this.host)

			this.socket.setMulticastLoopback(true)
			this.socket.setMulticastTTL(1)

			this.instaceId = crypto.randomUUID()

			this.send({
				type: 'announce',
				data: {
					id: this.id,
					handshake,
				},
			})

			this.announceInterval = setInterval(() => {
				this.send({
					type: 'announce',
					data: {
						id: this.id,
						handshake,
					},
				})
			}, this.announceIntervalDelay)
		})
	}

	public close(error: Error = undefined) {
		clearInterval(this.announceInterval)

		this.socket.close()

		if (error) this.emit('error', error)
		this.emit('close')
	}

	public get id() {
		return this.instaceId
	}

	private rawSend(message: string) {
		this.socket.send(message, this.port, this.host)
	}

	private send(send: ISend) {
		this.rawSend(JSON.stringify(send))
	}

	public sendData(data: Data) {
		this.rawSend(
			JSON.stringify({
				type: 'data',
				data,
			})
		)
	}

	private parseMessage(message: Buffer, remoteInfo: dgram.RemoteInfo) {
		const messageString = message.toString()

		const [isValid, data] = IsValidJson<ISendData<Data> | ISend>(
			messageString
		)

		if (!isValid) return // Ignore invalid messages

		if (data.type === 'announce') {
			this.emit('newService', remoteInfo, data.data.handshake)
		} else if (data.type === 'data') {
			this.emit('data', data.data as Data)
		}
	}
}

export default ServiceDiscovery
