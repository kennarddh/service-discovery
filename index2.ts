import ServiceDiscovery from './ServiceDiscovery.js'

const serviceDiscovery = new ServiceDiscovery<string>({
	serverOptions: {
		announceInterval: 10000,
	},
	clientOptions: {
		shouldAcceptDataBeforeAnnounce: false,
	},
})

serviceDiscovery.on('start', ({ socket }) => {
	const address = socket.address()

	console.log(
		`Listening ${address.address}:${address.port} as ${
			serviceDiscovery.isServer
				? 'server'
				: serviceDiscovery.isClient
				? 'client'
				: ''
		}, Id: ${serviceDiscovery.id}`
	)
})

serviceDiscovery.on('error', error => {
	console.error('Server error:\n', error)
})

serviceDiscovery.on('close', () => {
	console.log('Server closed')
})

serviceDiscovery.on('newPeer', ({ remoteInfo, handshake, sender }) => {
	console.log('New peer joined, ', {
		port: remoteInfo.port,
		host: remoteInfo.address,
		handshake,
		sender,
	})
})

serviceDiscovery.on('data', data => {
	console.log(data)
})

if (!!process.argv[2]) {
	serviceDiscovery.listen(true, {
		data: 1,
	})
} else {
	serviceDiscovery.listen(false)
}

setInterval(() => {
	serviceDiscovery.sendData('a')
}, 3000)
