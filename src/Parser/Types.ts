import { IAllPacket } from '../Types'

interface IParser<Data> {
	isValidPacket(data: Buffer): [true, IAllPacket<Data>] | [false, null]
	serializePacket(data: IAllPacket<Data>): Buffer
}

export type IIsValidBody<Data> = (test: unknown) => test is Data

export interface ParserOptions<Data> {
	isValidBody: IIsValidBody<Data>
}

export default IParser
