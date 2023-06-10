import dgram from 'dgram'

import { UUID } from 'crypto'

import BaseParser from './Parser/BaseParser'

export interface IEvents<Data> {
	start: (data: { socket: dgram.Socket }) => void
	close: () => void
	error: (error: Error) => void
	data: (data: { data: Data; sender: IPeer }) => void
	newPeer: (data: {
		remoteInfo: dgram.RemoteInfo
		handshake: IHandshake
		sender: IPeer
	}) => void
	peerRemoved: (data: { remoteInfo: dgram.RemoteInfo; sender: IPeer }) => void
}

export interface IInternalEvents {
	acknowledgementReceivedAll: (data: { packetId: UUID }) => void
}

export interface IPeer {
	id: UUID
}

export interface IPacketBodyBase {}

export enum IPacketBodyType {
	Announce,
	Close,
	Data,
}

export interface IPacketBodyAnnounce extends IPacketBodyBase {
	type: IPacketBodyType.Announce
	data: {
		handshake: IHandshake
	}
}

export interface IPacketBodyClose extends IPacketBodyBase {
	type: IPacketBodyType.Close
}

export interface IPacketBodyData<T> extends IPacketBodyBase {
	type: IPacketBodyType.Data
	data: T
}

export type IPacketBody = IPacketBodyAnnounce | IPacketBodyClose

export type IAllPacketBody<Data> = IPacketBodyData<Data> | IPacketBody

export enum IPacketType {
	Acknowledgement,
	Data,
}

export type ITargetIds = UUID[] | '*'

export interface IPacketData<Data> {
	type: IPacketType.Data
	id: UUID
	body: IAllPacketBody<Data>
	sender: IPeer
	targetIds: ITargetIds
}

export interface IPacketAcknowledgement {
	type: IPacketType.Acknowledgement
	acknowledgedId: UUID
	sender: IPeer
	targetIds: ITargetIds
}

export type IAllPacket<Data> = IPacketAcknowledgement | IPacketData<Data>

export type IHandshake = Record<string, any>

export interface IOptions<Data> {
	host?: string
	port?: number
	ttl?: number

	announceInterval?: number
	shouldAcceptDataBeforeAnnounce?: boolean

	peerAnnounceTimeout?: number

	acknowledgementTimeout?: number
	maxRetry?: number

	parser: BaseParser<Data>
}

export type ICheckPeerTimeouts = Record<string, NodeJS.Timer>

export type IPendingAcknowledgements = Record<
	UUID,
	{
		intervalId: NodeJS.Timer
		pendingTarget: UUID[]
		remainingRetry: number
	}
>

export type IKnownPackets = Record<UUID, { timeoutId: NodeJS.Timer }>
