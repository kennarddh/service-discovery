import Diont from 'diont'
import GetFreePort from './GetFreePort.js'
import net from 'net'

import * as readline from 'node:readline/promises'

import { stdin as input, stdout as output } from 'node:process'

interface IData {
	sender: string
	message: string
}

const rl = readline.createInterface({ input, output })

const diont = Diont({
	ttl: 128,
})

let clients: net.Socket[] = []

// ======
// Listen for announcements and renouncements in services
// ======
diont.on('serviceAnnounced', function (serviceInfo: any) {
	// A service was announced
	// This function triggers for services not yet available in diont.getServiceInfos()
	// serviceInfo is an Object { isOurService : Boolean, service: Object }
	// service.name, service.host and service.port are always filled
	// console.log('A new service was announced', serviceInfo.service)

	console.log(
		`\x1b[33m${serviceInfo.service.port}\x1b[0m \x1b[34mJoined\x1b[0m`
	)

	const conn = net.createConnection({
		host: serviceInfo.service.host,
		port: serviceInfo.service.port,
	})

	conn.on('connect', () => {
		clients = [...clients, conn]
	})
})

const port = process.argv[2]
	? parseInt(process.argv[2], 10)
	: await GetFreePort()

console.log(`Running ${port}`)

const server = net.createServer()

server.on('connection', socket => {
	socket.on('data', data => {
		const parsedData: IData = JSON.parse(data.toString())

		console.log(`\x1b[33m${parsedData.sender}\x1b[0m ${parsedData.message}`)
	})
})

server.listen(port)

const service = {
	name: 'Server',
	port,
}

setInterval(function () {
	diont.announceService(service)
	console.log('All known services', diont.getServiceInfos())
}, 5000)

rl.prompt()

rl.on('line', message => {
	for (const client of clients) {
		const sendData: IData = {
			sender: port.toString(),
			message,
		}

		client.write(JSON.stringify(sendData))
	}
})
