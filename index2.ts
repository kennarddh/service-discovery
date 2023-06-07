import ServiceDiscovery from './ServiceDiscovery.js'

const serviceDiscovery = new ServiceDiscovery<string>()

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
	console.error('Socket error:\n', error)
})

serviceDiscovery.on('close', () => {
	console.log('Socket closed')

	clearInterval(dataIntervalId)
})

serviceDiscovery.on('newPeer', ({ remoteInfo, handshake, sender }) => {
	console.log('New peer joined, ', {
		port: remoteInfo.port,
		host: remoteInfo.address,
		handshake,
		sender,
	})
})

serviceDiscovery.on('peerRemoved', ({ remoteInfo, sender }) => {
	console.log('Peer removed, ', {
		port: remoteInfo.port,
		host: remoteInfo.address,
		sender,
	})
})

serviceDiscovery.on('data', data => {
	console.log(data)
})

if (!!process.argv[2]) {
	serviceDiscovery.listenServer({
		data: 1,
	})
} else {
	serviceDiscovery.listenClient({
		data: 0,
	})
}

const dataIntervalId = setInterval(() => {
	if (serviceDiscovery.isListening) {
		// serviceDiscovery.sendData('a')
	} else {
		clearInterval(dataIntervalId)
	}
}, 3000)

// setTimeout(() => {
// 	if (!!process.argv[2]) {
// 		serviceDiscovery.close()
// 	}
// }, 10000)
