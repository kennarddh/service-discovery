import net, { AddressInfo } from 'net'

const GetFreePort = () =>
	new Promise<number>(resolve => {
		const server = net.createServer()

		server.listen(0, () => {
			const port = (server.address() as AddressInfo).port

			server.close(() => resolve(port))
		})
	})

export default GetFreePort
