import os from 'os'

const GetIPv4Addresses = () =>
	Object.values(os.networkInterfaces())
		.flat()
		.filter(({ family, internal }) => family === 'IPv4' && !internal)
		.map(({ address }) => address)

export default GetIPv4Addresses
