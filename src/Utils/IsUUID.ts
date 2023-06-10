import { UUID } from 'crypto'

import IsString from './IsString.js'

const IsUUID = (testStr: unknown): testStr is UUID => {
	if (!testStr) return false

	if (!IsString(testStr)) return false

	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		testStr
	)
}

export default IsUUID
