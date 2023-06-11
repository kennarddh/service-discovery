import { IAllPacket } from '../Types'
import IParser, {
	IIsValidBody,
	IIsValidHandshake,
	IParserOptions,
} from './Types'

abstract class BaseParser<Handshake, Data> implements IParser<Handshake, Data> {
	protected isValidBody: IIsValidBody<Data>
	protected isValidHandshake: IIsValidHandshake<Handshake>

	constructor({
		isValidBody,
		isValidHandshake,
	}: IParserOptions<Handshake, Data>) {
		this.isValidBody = isValidBody
		this.isValidHandshake = isValidHandshake
	}

	public abstract isValidPacket(
		data: Buffer
	): [false, null] | [true, IAllPacket<Handshake, Data>]

	public abstract serializePacket(data: IAllPacket<Handshake, Data>): Buffer
}

export default BaseParser
