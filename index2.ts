import ServiceDiscovery from './ServiceDiscovery.js'

const serviceDiscovery = new ServiceDiscovery<string>()

serviceDiscovery.on('start', socket => {
	const address = socket.address()

	console.log(`Listening ${address.address}:${address.port}`)
})

serviceDiscovery.on('error', error => {
	console.error('Server error:\n', error)
})

serviceDiscovery.on('close', () => {
	console.log('Server closed')
})

serviceDiscovery.on('newService', (remoteInfo, handshake) => {
	console.log('New service joined, ', { remoteInfo, handshake })
})

serviceDiscovery.on('data', data => {
	console.log(data)
})

serviceDiscovery.listen()

setInterval(() => {
	serviceDiscovery.sendData('a')
}, 1000)
