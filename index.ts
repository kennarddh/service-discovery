import Diont from 'diont'
import GetFreePort from './GetFreePort.js'
import net from 'net'
import EventEmitter from 'events'
const diont = Diont()

// ======
// Listen for announcements and renouncements in services
// ======
diont.on('serviceAnnounced', function (serviceInfo: any) {
	// A service was announced
	// This function triggers for services not yet available in diont.getServiceInfos()
	// serviceInfo is an Object { isOurService : Boolean, service: Object }
	// service.name, service.host and service.port are always filled
	console.log('A new service was announced', serviceInfo.service)

	const conn = net.createConnection({
		host: serviceInfo.service.host,
		port: serviceInfo.service.port,
	})

	conn.on('connect', () => {
		console.log('Connected', serviceInfo)

		conn.write('data')
	})
})

const port = await GetFreePort()

console.log(`Running ${port}`)

const server = net.createServer()

server.on('connection', socket => {
	socket.on('data', data => {
		console.log(socket.remotePort, data.toString())
	})
})

server.listen(port)

const service = {
	name: 'Server',
	port,
	// any additional information is allowed and will be propagated
}

// Renounce after 5 seconds
setInterval(function () {
	diont.announceService(service)
	// console.log('All known services', diont.getServiceInfos())
}, 5000)
