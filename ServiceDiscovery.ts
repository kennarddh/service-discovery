import dgram from 'node:dgram'
import crypto from 'node:crypto'

import { TypedEmitter } from 'tiny-typed-emitter'

import IsValidJson from './IsValidJson.js'

interface IEvents {
	start: (socket: dgram.Socket) => void
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
					handshake,
				},
				sender: {
					id: this.id,
				},
			})

			this.announceInterval = setInterval(() => {
				this.send({
					type: 'announce',
					data: {
						handshake,
					},
					sender: {
						id: this.id,
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
