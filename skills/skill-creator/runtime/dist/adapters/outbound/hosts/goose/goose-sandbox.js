import { constants } from "node:fs";
import { access, lstat, readlink, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
/** Root entries a dynamically linked host binary needs; merged-/usr symlinks are replicated. */
const SYSTEM_ENTRIES = ["/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32"];
/** Read-only system trees. /home, /root, /mnt, /media, /srv, /var, /dev/shm and the real /tmp are
 * deliberately absent: that is where real Skill checkouts and concurrent private trial roots live. */
const READ_ONLY = ["/usr", "/etc", "/opt"];
/** Resolver stub targets (e.g. /etc/resolv.conf -> /run/systemd/resolve/stub-resolv.conf). */
const RESOLVER = ["/run/systemd/resolve", "/run/NetworkManager", "/run/resolvconf"];
/**
 * Pure argument builder (ap-15xv). Order matters: the tmpfs on /tmp must precede the private
 * root/workspace binds that usually live below it, otherwise the binds are hidden. Network is
 * shared because the provider API is remote; this sandbox protects host files, not egress.
 */
export function bubblewrapArguments(layout, command) {
    const args = [];
    for (const path of READ_ONLY)
        args.push("--ro-bind-try", path, path);
    for (const entry of layout.system) {
        if (entry.symlink !== undefined)
            args.push("--symlink", entry.symlink, entry.path);
        else
            args.push("--ro-bind-try", entry.path, entry.path);
    }
    args.push("--tmpfs", "/tmp", "--dev", "/dev", "--proc", "/proc");
    for (const path of RESOLVER)
        args.push("--ro-bind-try", path, path);
    // Executables outside the read-only trees (e.g. ~/.local/bin/goose) are exposed alone.
    if (!READ_ONLY.some(prefix => layout.executable.startsWith(`${prefix}/`)))
        args.push("--ro-bind", layout.executable, layout.executable);
    args.push("--bind", layout.root, layout.root);
    if (layout.workspace !== layout.root && !layout.workspace.startsWith(`${layout.root}/`))
        args.push("--bind", layout.workspace, layout.workspace);
    // --new-session: no controlling terminal for TIOCSTI keystroke injection, even if the
    // caller ever stops spawning detached (setsid) processes.
    args.push("--unshare-all", "--share-net", "--die-with-parent", "--new-session", "--chdir", layout.workspace, "--", layout.executable, ...command);
    return args;
}
/** Host-specific root layout, read once per probe. */
export async function systemEntries() {
    const entries = [];
    for (const path of SYSTEM_ENTRIES) {
        try {
            const info = await lstat(path);
            entries.push(info.isSymbolicLink() ? { path, symlink: await readlink(path) } : { path });
        }
        catch { /* Absent on this distribution. */ }
    }
    return entries;
}
/** Resolve a PATH command to its real file so the sandbox can expose exactly that binary. */
export async function resolveExecutable(command, path) {
    const candidates = isAbsolute(command) ? [command] : (path ?? "").split(delimiter).filter(isAbsolute).map(directory => join(directory, command));
    for (const candidate of candidates) {
        try {
            await access(candidate, constants.X_OK);
            return await realpath(candidate);
        }
        catch { /* Next PATH entry. */ }
    }
    throw new Error("Goose executable not found for sandboxed execution");
}
