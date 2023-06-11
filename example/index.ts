import { readFileSync } from 'node:fs'

import ServiceDiscovery from '../src/ServiceDiscovery.js'

import JSONParser from '../src/Parser/JSONParser.js'

import IsString from '../src/Utils/IsString.js'

interface IHandshake {
	data: number
}

const serviceDiscovery = new ServiceDiscovery<IHandshake, string>({
	parser: new JSONParser({
		isValidBody: IsString,
		isValidHandshake(test): test is IHandshake {
			if (test === undefined) return false
			if (test?.data === undefined) return false

			if (typeof test.data !== 'number') return false

			return true
		},
	}),
})

serviceDiscovery.on('start', ({ socket }) => {
	const address = socket.address()

	console.log(
		`Listening ${address.address}:${address.port}, Id: ${serviceDiscovery.id}`
	)
})

serviceDiscovery.on('error', error => {
	console.error('Socket error:\n', error)
})

serviceDiscovery.on('close', () => {
	console.log('Socket closed')

	clearInterval(dataIntervalId)
})

serviceDiscovery.on('newPeer', ({ remoteInfo, handshake, peer }) => {
	console.log('New peer joined, ', {
		port: remoteInfo.port,
		host: remoteInfo.address,
		handshake,
		peer,
	})
})

serviceDiscovery.on('peerRemoved', ({ remoteInfo, peer }) => {
	console.log('Peer removed, ', {
		port: remoteInfo.port,
		host: remoteInfo.address,
		peer,
	})
})

serviceDiscovery.on('data', data => {
	console.log(data)
})

if (!!process.argv[2]) {
	serviceDiscovery.listen({
		data: 1,
	})
} else {
	serviceDiscovery.listen({
		data: 0,
	})
}

const dataIntervalId = setInterval(() => {
	if (serviceDiscovery.isListening) {
		if (!!process.argv[2]) {
			serviceDiscovery.sendData('a')
		}
	} else {
		clearInterval(dataIntervalId)
	}
}, 20000)

setTimeout(() => {
	console.log(15000)
	// serviceDiscovery.sendData('a')
}, 15000)

// const largeText = readFileSync('./largeText60000.txt').toString('utf-8')

// setTimeout(() => {
// 	serviceDiscovery.sendData(largeText, () => console.log('all peer received'))
// }, 5000)

// setTimeout(async () => {
// 	if (!!process.argv[2]) {
// 		await serviceDiscovery.close()
// 	}
// }, 10000)
