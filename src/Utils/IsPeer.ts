import IsUUID from './IsUUID.js'

import { IPeer } from '../Types'

const IsPeer = (peer: Partial<IPeer> | undefined): peer is IPeer => {
	if (!peer) return false
	if (!peer?.id) return false
	if (!IsUUID(peer.id)) return false

	return true
}

export default IsPeer
