import IsUUID from './IsUUID.js'

import { ITargetIds } from '../Types'

const IsTargetIds = (
	testIds: ITargetIds | undefined
): testIds is ITargetIds => {
	if (!testIds) return false

	if (testIds === '*') return true
	if (testIds.every(id => IsUUID(id))) return true

	return false
}

export default IsTargetIds
