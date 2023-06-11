import {
	IAllPacket,
	IAllPacketBody,
	IPacketAcknowledgement,
	IPacketBodyType,
	IPacketData,
	IPacketType,
} from '../Types.js'

import IsPeer from '../Utils/IsPeer.js'
import IsTargetIds from '../Utils/IsTargetIds.js'
import IsUUID from '../Utils/IsUUID.js'
import IsValidJSON from '../Utils/IsValidJSON.js'

import BaseParser from './BaseParser.js'
import { IParserOptions } from './Types'

class JSONParser<Handshake, Data> extends BaseParser<Handshake, Data> {
	constructor({
		isValidBody,
		isValidHandshake,
	}: IParserOptions<Handshake, Data>) {
		super({ isValidBody, isValidHandshake })
	}

	public isValidPacket(
		data: Buffer
	): [false, null] | [true, IAllPacket<Handshake, Data>] {
		const [isValidJSON, parsedData] = IsValidJSON<
			Partial<IAllPacket<Handshake, Data>>
		>(data.toString())

		if (!isValidJSON) return [false, null]

		if (this.isPacketAcknowledgement(parsedData)) {
			return [true, parsedData]
		} else if (this.isPacketData(parsedData)) {
			return [true, parsedData]
		}

		return [false, null]
	}

	public serializePacket(data: IAllPacket<Handshake, Data>): Buffer {
		return Buffer.from(JSON.stringify(data))
	}

	private isPacketAcknowledgement(
		test: Partial<IAllPacket<Handshake, Data>>
	): test is IPacketAcknowledgement {
		return (
			test?.type === IPacketType.Acknowledgement &&
			IsUUID(test?.acknowledgedId) &&
			IsPeer(test?.sender) &&
			IsTargetIds(test?.targetIds)
		)
	}

	private isPacketData(
		test: Partial<IAllPacket<Handshake, Data>>
	): test is IPacketData<Handshake, Data> {
		return (
			test?.type === IPacketType.Data &&
			IsUUID(test?.id) &&
			IsPeer(test?.sender) &&
			IsTargetIds(test?.targetIds) &&
			this.isValidPacketDataBody(test?.body)
		)
	}

	private isValidPacketDataBody(
		body: Partial<IAllPacketBody<Handshake, Data>>
	): body is IAllPacketBody<Handshake, Data> {
		if (
			body?.type === IPacketBodyType.Announce &&
			this.isValidHandshake(body?.data?.handshake)
		)
			return true
		else if (body?.type === IPacketBodyType.Close) return true
		else if (
			body?.type === IPacketBodyType.Data &&
			this.isValidBody(body?.data)
		)
			return true

		return false
	}
}

export default JSONParser
