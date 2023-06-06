import ServiceDiscovery from './ServiceDiscovery.js'

const serviceDiscovery = new ServiceDiscovery()

serviceDiscovery.on('listening', socket => {
	const address = socket.address()

	console.log(`Listening ${address.address}:${address.port}`)
})

serviceDiscovery.listen()
