import { IAllPacket } from '../Types'

interface IParser<Data> {
	isValidPacket(data: Buffer): [true, IAllPacket<Data>] | [false, null]
	serializePacket(data: IAllPacket<Data>): Buffer
}

export default IParser
