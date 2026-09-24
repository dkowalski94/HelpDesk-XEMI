# Archive SHA repoint

## 2026-09-24

- **Target**: `origin/master` (remote default branch per `git ls-remote --symref origin HEAD`; base of PR #1), snapshot `22ba63be74eb23e04ad011bbc3bccb932943bac3`
- **Integration**: PR https://github.com/dkowalski94/HelpDesk-XEMI/pull/1 (MERGED, rebase merge). Head commit on the target: `22ba63b` fix(tenant-data-and-auth-foundation): Resolve full-plan review findings
- **Why**: the 12 implementation commits existed only on the local `master` and reached GitHub for the first time inside PR #1. The rebase merge rewrote every commit, so the original Progress SHAs are not in the target history (`git merge-base --is-ancestor` exit 1).
- **Evidence**: all old SHAs are in PR #1's commit list. Each old commit has exactly one rewritten counterpart in `aebfe4f..22ba63b` with an identical `git patch-id --stable`, so the code change is the same. Every new SHA is an ancestor of the snapshot (exit 0). The epilogue trees are identical (`git diff 109346e 8148c0c` is empty).
- **Decision**: user chose "Zaktualizuj i archiwizuj" (update and archive) in `/10x-archive`.
- **Unchanged**: 2.12, 5.6 and 5.7 have no SHA suffix and were left as they were.

| Rows | Old suffix (resolved OID) | New SHA |
|---|---|---|
| 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10 | `e0b9b05` (`e0b9b05e25ac0873fff2b1cefe115421a96bd6f3`) | `59e4d95` |
| 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11 | `a13931d` (`a13931d467e76edf36e615195c61984d4be0c712`) | `fb833a4` |
| 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7 | `901c68f` (`901c68f572ff65b1654221974f2e1c4a1e935f8a`) | `238dd37` |
| 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8 | `37e17b7` (`37e17b7b9399fbf62d6005caebf8ad828691314d`) | `44965f9` |
| 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9, 5.10 | `ae494e5` (`ae494e595a9ecd13442e0e4aef6503124afc6c04`) | `38996df` |

**Rows repointed: 44**
