import { IAllPacket } from '../Types'
import IParser, { IIsValidBody } from './Types'

abstract class BaseParser<Data> implements IParser<Data> {
	protected isValidBody: IIsValidBody<Data>

	constructor({ isValidBody }: { isValidBody: IIsValidBody<Data> }) {
		this.isValidBody = isValidBody
	}

	public abstract isValidPacket(
		data: Buffer
	): [false, null] | [true, IAllPacket<Data>]

	public abstract serializePacket(data: IAllPacket<Data>): Buffer
}

export default BaseParser
