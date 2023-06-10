const SetImmediateInterval = (
	callback: () => void,
	interval: number
): NodeJS.Timer => {
	callback()

	return setInterval(callback, interval)
}

export default SetImmediateInterval
