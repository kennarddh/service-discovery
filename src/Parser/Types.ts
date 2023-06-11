import { IAllPacket } from '../Types'

interface IParser<Handshake, Data> {
	isValidPacket(
		data: Buffer
	): [true, IAllPacket<Handshake, Data>] | [false, null]
	serializePacket(data: IAllPacket<Handshake, Data>): Buffer
}

export type IIsValidBody<Data> = (
	test: Partial<Data> | undefined
) => test is Data

export type IIsValidHandshake<Handshake> = (
	test: Partial<Handshake> | undefined
) => test is Handshake

export interface IParserOptions<Handshake, Data> {
	isValidBody: IIsValidBody<Data>
	isValidHandshake: IIsValidHandshake<Handshake>
}

export default IParser
