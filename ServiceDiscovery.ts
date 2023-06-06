import dgram from 'node:dgram'

import crypto from 'crypto'

import { TypedEmitter } from 'tiny-typed-emitter'

interface IEvents {
	listening: (socket: dgram.Socket) => void
	close: () => void
}

interface ISendDataBase<
	T extends Record<string | number | symbol, any> = Record<string, never>
> {
	data?: T
}

interface ISendDataAnnounce
	extends ISendDataBase<{
		id: string
		handshake: IHandshake
	}> {
	type: 'announce'
}

interface ISendDataData<T> extends ISendDataBase<T> {
	type: 'data'
}

type ISendData<
	T extends Record<string | number | symbol, any> = Record<string, never>
> = ISendDataAnnounce | ISendDataData<T>

type IHandshake = Record<string, any>

class ServiceDiscovery extends TypedEmitter<IEvents> {
	#socket: dgram.Socket
	#host: string
	#port: number

	#id: string

	#announceIntervalDelay: number
	#announceInterval: NodeJS.Timer

	constructor({
		host = '224.0.0.114',
		port = 60540,
		announceIntervalDelay = 2000,
	} = {}) {
		super()

		this.#host = host
		this.#port = port
		this.#announceIntervalDelay = announceIntervalDelay
	}

	listen(handshake: IHandshake = {}) {
		this.#socket = dgram.createSocket({
			type: 'udp4',
			reuseAddr: true,
		})

		this.#socket.on('error', err => {
			console.error(`Server error:\n${err.stack}`)
			this.#socket.close()
		})

		this.#socket.on('message', (msg, rinfo) => {
			console.log(
				`server got: '${msg}' from ${rinfo.address}:${rinfo.port}`
			)
		})

		this.#socket.on('listening', () => {
			this.emit('listening', this.#socket)
		})

		this.#socket.bind(this.#port, () => {
			this.#socket.addMembership(this.#host)

			this.#socket.setMulticastLoopback(true)
			this.#socket.setMulticastTTL(1)

			this.#id = crypto.randomUUID()

			this.dgramSend({
				type: 'announce',
				data: {
					id: this.#id,
					handshake,
				},
			})

			this.#announceInterval = setInterval(() => {
				this.dgramSend({
					type: 'announce',
					data: {
						id: this.#id,
						handshake,
					},
				})
			}, this.#announceIntervalDelay)
		})
	}

	close() {
		clearInterval(this.#announceInterval)
		this.#socket.close()

		this.emit('close')
	}

	public get id() {
		return this.#id
	}

	private dgramRawSend(message: string) {
		this.#socket.send(message, this.#port, this.#host)
	}

	dgramSend(sendData: ISendData) {
		this.dgramRawSend(JSON.stringify(sendData))
	}
}

export default ServiceDiscovery
