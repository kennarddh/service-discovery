const IsValidJSON = <T>(str: string): [boolean, T] => {
	try {
		return [true, JSON.parse(str)]
	} catch (err) {
		return [false, null]
	}
}

export default IsValidJSON
