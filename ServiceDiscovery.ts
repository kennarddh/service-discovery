import dgram from 'node:dgram'
import GetFreePort from './GetFreePort.js'

const server = dgram.createSocket({
	type: 'udp4',
	reuseAddr: true,
})

server.on('error', err => {
	console.error(`server error:\n${err.stack}`)
	server.close()
})

server.on('message', (msg, rinfo) => {
	console.log(`server got: '${msg}' from ${rinfo.address}:${rinfo.port}`)
})

server.on('listening', () => {
	const address = server.address()
	console.log(`server listening ${address.address}:${address.port}`)
})

server.on('connect', () => console.log('connect'))

const port = 60540

const id = await GetFreePort()

const multicastHost = '224.0.0.114'

server.bind(port, () => {
	server.addMembership(multicastHost)

	server.setMulticastLoopback(true)
	server.setMulticastTTL(1)
	server.setBroadcast(true)

	const message = id.toString()

	setInterval(() => {
		server.send(message, port, multicastHost)
	}, 1000)
})
