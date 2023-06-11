import dgram from 'dgram'

import { UUID } from 'crypto'

import BaseParser from './Parser/BaseParser'

export interface IEvents<Handshake, Data> {
	start: (data: { socket: dgram.Socket }) => void
	close: () => void
	error: (error: Error) => void
	data: (data: { data: Data; sender: ISender }) => void
	newPeer: (data: {
		remoteInfo: dgram.RemoteInfo
		handshake: Handshake
		peer: IPeer
	}) => void
	peerRemoved: (data: { remoteInfo: dgram.RemoteInfo; peer: IPeer }) => void
}

export interface IInternalEvents {
	acknowledgementReceivedAll: (data: { packetId: UUID }) => void
}

export interface IPeer {
	id: UUID
	host: string
	port: number
}

export type ISender = UUID

export type IReceivers = UUID[] | '*'

export interface IPacketBodyBase {}

export enum IPacketBodyType {
	Announce,
	Close,
	Data,
}

export interface IPacketBodyAnnounce<Handshake> extends IPacketBodyBase {
	type: IPacketBodyType.Announce
	data: {
		handshake: Handshake
	}
}

export interface IPacketBodyClose extends IPacketBodyBase {
	type: IPacketBodyType.Close
}

export interface IPacketBodyData<T> extends IPacketBodyBase {
	type: IPacketBodyType.Data
	data: T
}

export type IPacketBody<Handshake> =
	| IPacketBodyAnnounce<Handshake>
	| IPacketBodyClose

export type IAllPacketBody<Handshake, Data> =
	| IPacketBodyData<Data>
	| IPacketBody<Handshake>

export enum IPacketType {
	Acknowledgement,
	Data,
}

export interface IPacketData<Handshake, Data> {
	type: IPacketType.Data
	id: UUID
	body: IAllPacketBody<Handshake, Data>
	sender: ISender
}

export interface IPacketAcknowledgement {
	type: IPacketType.Acknowledgement
	acknowledgedId: UUID
	sender: ISender
}

export type IAllPacket<Handshake, Data> =
	| IPacketAcknowledgement
	| IPacketData<Handshake, Data>

export interface IOptions<Handshake, Data> {
	host?: string
	port?: number
	ttl?: number

	announceInterval?: number
	shouldAcceptDataBeforeAnnounce?: boolean

	peerAnnounceTimeout?: number

	acknowledgementTimeout?: number
	maxRetry?: number

	parser: BaseParser<Handshake, Data>
}

export type ICheckPeerTimeouts = Record<string, NodeJS.Timer>

export type IPendingAcknowledgements = Record<
	UUID,
	{
		intervalId: NodeJS.Timer
		pendingReceivers: Exclude<IReceivers, '*'>
		remainingRetry: number
	}
>

export type IKnownPackets = Record<UUID, { timeoutId: NodeJS.Timer }>
