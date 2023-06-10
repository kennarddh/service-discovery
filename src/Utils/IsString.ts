const IsString = (test: unknown): test is string => {
	if (typeof test === 'string') return true

	return false
}

export default IsString
