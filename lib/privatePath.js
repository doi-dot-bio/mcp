// Pure path predicates for private folders. No requires: copied verbatim into mcp/.
// A path is private when a DIRECTORY segment is named exactly `private` (case-sensitive);
// a final segment named `private` is a file and does not count.

function isPrivatePath(rel) {
    return privateRoot(rel) !== null;
}

// The rel dir up to and including the first private directory segment, or null.
function privateRoot(rel) {
    const segs = String(rel).split('/');
    for (let i = 0; i < segs.length - 1; i++) {
        if (segs[i] === 'private') return segs.slice(0, i + 1).join('/');
    }
    return null;
}

// An index file_path such as /x/vaults/companies/private/a.md. Fails closed: ANY directory segment
// named `private` makes it private, except the one segment right after a `vaults` segment (the
// vault-name position: a vault literally named `private` is not itself private). So a root that
// is not literally named `vaults` (a temp dir, `ovaults`) still hides private folders.
function isPrivateIndexedPath(filePath) {
    const segs = String(filePath).split('/');
    for (let i = 0; i < segs.length - 1; i++) {
        if (segs[i] === 'private' && !(i > 0 && segs[i - 1] === 'vaults')) return true;
    }
    return false;
}

module.exports = { isPrivatePath, privateRoot, isPrivateIndexedPath };
