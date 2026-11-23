/**
 * Chat audit §6 — thread-history grouping and filtering.
 *
 * These are the pure helpers the sidebar renders through, so a regression here
 * is a regression in what the user sees in the Conversations column.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayBucket, filterThreads, groupThreads } from '../src/thread-groups.ts';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

test('dayBucket counts CALENDAR days off local midnight, not elapsed hours', () => {
    const now = new Date(2026, 10, 23, 0, 10); // 23 Nov 2026, 00:10
    assert.equal(dayBucket(at(2026, 11, 23, 9), now), 'Today');
    // 25 minutes earlier in wall-clock terms, but the previous calendar day.
    assert.equal(dayBucket(at(2026, 11, 22, 23, 50), now), 'Yesterday',
        'a late-evening thread must not read as Today');
    assert.equal(dayBucket(at(2026, 11, 21), now), 'This week');
    assert.equal(dayBucket(at(2026, 11, 18), now), 'This week');
    const older = dayBucket(at(2026, 11, 1), now);
    assert.ok(!['Today', 'Yesterday', 'This week', 'Earlier'].includes(older),
        'past a week the bucket is a date, not a relative label');
});

test('dayBucket degrades to Earlier on unusable input', () => {
    assert.equal(dayBucket(''), 'Earlier');
    assert.equal(dayBucket('not a date'), 'Earlier');
});

test('filterThreads is case-insensitive and blank-safe', () => {
    const list = [
        { id: 'a', title: 'Implementation Status Audit', updated_at: at(2026, 11, 23) },
        { id: 'b', title: 'Fix login bug', updated_at: at(2026, 11, 23) },
        { id: 'c', title: null as unknown as string, updated_at: at(2026, 11, 22) },
    ];
    assert.equal(filterThreads(list, '').length, 3, 'blank query keeps everything');
    assert.equal(filterThreads(list, '   ').length, 3, 'whitespace is blank');
    assert.deepEqual(filterThreads(list, 'LOGIN').map(t => t.id), ['b']);
    assert.deepEqual(filterThreads(list, 'audit').map(t => t.id), ['a']);
    assert.deepEqual(filterThreads(list, 'fix').map(t => t.id), ['b'], 'matches mid-word too');
    assert.equal(filterThreads(list, 'nothing-matches').length, 0);
    // A null title must not throw and must not match: it is compared as ''.
    assert.equal(filterThreads(list, 'zz').length, 0);
});

test('groupThreads buckets in order and keeps each bucket contiguous', () => {
    const now = new Date(2026, 10, 23, 12, 0);
    const list = [
        { id: 't1', title: 'Today A', updated_at: at(2026, 11, 23, 11) },
        { id: 't2', title: 'Today B', updated_at: at(2026, 11, 23, 9) },
        { id: 'y1', title: 'Yesterday A', updated_at: at(2026, 11, 22, 18) },
        { id: 'w1', title: 'Last week', updated_at: at(2026, 11, 12, 8) },
    ];
    const groups = groupThreads(list, '', now);
    assert.deepEqual(groups.map(g => g.bucket), ['Today', 'Yesterday', groups[2].bucket]);
    assert.deepEqual(groups[0].threads.map(t => t.id), ['t1', 't2'], 'order within a bucket is preserved');
    assert.deepEqual(groups[1].threads.map(t => t.id), ['y1']);
    assert.deepEqual(groups.flatMap(g => g.threads).map(t => t.id), list.map(t => t.id),
        'no thread is lost or reordered overall');
});

test('groupThreads applies the search before bucketing', () => {
    const now = new Date(2026, 10, 23, 12, 0);
    const list = [
        { id: 't1', title: 'Alpha work', updated_at: at(2026, 11, 23, 11) },
        { id: 'y1', title: 'Beta work', updated_at: at(2026, 11, 22, 18) },
    ];
    const hit = groupThreads(list, 'alpha', now);
    assert.equal(hit.length, 1, 'only the matching bucket survives');
    assert.equal(hit[0].bucket, 'Today');
    assert.deepEqual(hit[0].threads.map(t => t.id), ['t1']);
    assert.equal(groupThreads(list, 'gamma', now).length, 0, 'a miss yields no groups');
});
