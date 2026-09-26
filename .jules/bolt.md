## 2024-05-20 - FileReader Performance Optimization
**Learning:** Using `String.prototype.split(/\r?\n/).length` to count lines in very large strings is highly inefficient, leading to memory bloat and garbage collection pauses since it creates an array of substrings.
**Action:** Replace `split` line counting with a simple O(1) space `indexOf('\n')` loop. This applies to any large string processing task (like indexing or file reading).
