function findMatches(string, pattern, options) {
    const matches = [];
    const regex = new RegExp(pattern, options);
    let match;

    while (match = regex.exec(string)) {
        const text = match[0];

        matches.push({
            text,
            start: regex.lastIndex - text.length,
            end: regex.lastIndex
        });
    }

    return matches;
}

function getMatchOverlaps(ranges) {
    return ranges
        .sort((previous, current) => {
            if (previous.start < current.start) return -1;
            if (previous.start > current.start) return 1;
            return 0;
        })
        .reduce((result, current, i, arr) => {
            if (i === 0) return result

            const previous = arr[i-1];
            const previousEnd = previous.end;
            const currentStart = current.start;

            if (previousEnd >= currentStart) {
                result.push({
                    previous: previous,
                    current: current,
                });
            }

            return result;
        }, []);
}

module.exports = {
    findMatches,
    getMatchOverlaps,
};
