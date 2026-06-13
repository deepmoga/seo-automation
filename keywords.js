// keywords.js
// Extracts and classifies keywords from crawled page data using simple
// frequency / n-gram analysis - no external APIs required. Produces:
//   - topKeywords: frequently used single/double-word terms (main keywords)
//   - longTailKeywords: longer (3-5 word) phrases - more specific, usually
//     lower competition
//   - perPage: top keyword for each page + whether it's used in
//     title/meta/H1 (used to drive improvement suggestions)

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "at", "by", "for", "with",
  "about", "against", "between", "into", "through", "during", "before",
  "after", "above", "below", "to", "from", "up", "down", "in", "out", "on",
  "off", "over", "under", "again", "further", "then", "once", "here", "there",
  "when", "where", "why", "how", "all", "any", "both", "each", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "s", "t", "can", "will", "just", "don", "should",
  "now", "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "having", "do", "does", "did", "doing", "this", "that", "these",
  "those", "i", "you", "he", "she", "it", "we", "they", "what", "which", "who",
  "whom", "as", "until", "while", "his", "her", "its", "our", "their", "your",
  "my", "me", "him", "them", "us", "am", "your", "yours", "ours", "theirs",
  "also", "would", "could", "may", "might", "must", "shall", "one", "click",
  "here", "read", "more", "page", "home", "menu", "search", "skip", "content"
]);

/**
 * Lowercase + strip punctuation, split into word tokens.
 */
function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Build n-grams (sequences of n consecutive non-stopword tokens) from raw
 * text. Stopwords are kept in the original sequence (so phrases read
 * naturally) but a phrase is only counted if its first/last words are
 * meaningful (not stopwords), to avoid junk like "is a great".
 */
function extractPhrases(text, n) {
  const words = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const phrases = [];

  for (let i = 0; i <= words.length - n; i++) {
    const slice = words.slice(i, i + n);
    if (STOPWORDS.has(slice[0]) || STOPWORDS.has(slice[slice.length - 1])) continue;
    if (slice.some((w) => w.length <= 1)) continue;
    phrases.push(slice.join(" "));
  }

  return phrases;
}

/**
 * Weighted text for a page: title/H1 count more than body text, since
 * they signal the page's intended primary topic.
 */
function buildWeightedText(page) {
  const title = (page.title || "") + " " + (page.title || "") + " " + (page.title || "");
  const h1 = (page.h1 || []).join(" ") + " " + (page.h1 || []).join(" ");
  const h2 = (page.h2 || []).join(" ");
  const body = page.bodyText || "";

  return { title, h1, h2, body, all: [title, h1, h2, body].join(" ") };
}

/**
 * Analyze keyword usage across all crawled pages.
 *
 * @param {Array} pages - analyzed pages (output of analyzer.analyzePages)
 * @returns {{ topKeywords: Array, longTailKeywords: Array, perPage: Array }}
 */
function analyzeKeywords(pages) {
  const singleCounts = new Map(); // word -> { count, pages: Set, weighted }
  const phraseCounts = new Map(); // phrase (3-5 words) -> { count, pages: Set }

  for (const page of pages) {
    const { title, h1, h2, body, all } = buildWeightedText(page);

    // Single-word frequency (weighted)
    for (const word of tokenize(all)) {
      const entry = singleCounts.get(word) || { count: 0, pages: new Set() };
      entry.count += 1;
      entry.pages.add(page.url);
      singleCounts.set(word, entry);
    }

    // Long-tail phrases (3-5 word n-grams) from title + h1 + h2 + body
    const phraseSource = [title, h1, h2, body].join(" ");
    for (const n of [3, 4, 5]) {
      for (const phrase of extractPhrases(phraseSource, n)) {
        const entry = phraseCounts.get(phrase) || { count: 0, pages: new Set() };
        entry.count += 1;
        entry.pages.add(page.url);
        phraseCounts.set(phrase, entry);
      }
    }
  }

  // Top single/double-word "main" keywords - sorted by frequency, then by
  // how many distinct pages use them (broad relevance to the site)
  const topKeywords = [...singleCounts.entries()]
    .map(([keyword, data]) => ({
      keyword,
      frequency: data.count,
      pageCount: data.pages.size
    }))
    .filter((k) => k.frequency >= 2)
    .sort((a, b) => b.frequency - a.frequency || b.pageCount - a.pageCount)
    .slice(0, 25);

  // Long-tail keywords - longer, more specific phrases, used at least twice
  const longTailKeywords = [...phraseCounts.entries()]
    .map(([phrase, data]) => ({
      phrase,
      frequency: data.count,
      pageCount: data.pages.size,
      wordCount: phrase.split(" ").length
    }))
    .filter((p) => p.frequency >= 2)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 25);

  // Per-page: figure out the page's likely target keyword (from title/H1)
  // and whether it's reflected in title, meta description and H1.
  const perPage = pages.map((page) => {
    const titleWords = new Set(tokenize(page.title || ""));
    const h1Words = new Set(tokenize((page.h1 || []).join(" ")));

    // Candidate keyword = most frequent meaningful word in title, else H1
    const candidates = titleWords.size > 0 ? titleWords : h1Words;

    let mainKeyword = "";
    let bestScore = -1;
    for (const word of candidates) {
      const score = (singleCounts.get(word)?.count || 0);
      if (score > bestScore) {
        bestScore = score;
        mainKeyword = word;
      }
    }

    const metaWords = new Set(tokenize(page.metaDescription || ""));

    return {
      url: page.url,
      mainKeyword,
      inTitle: mainKeyword ? titleWords.has(mainKeyword) : false,
      inH1: mainKeyword ? h1Words.has(mainKeyword) : false,
      inMetaDescription: mainKeyword ? metaWords.has(mainKeyword) : false
    };
  });

  return { topKeywords, longTailKeywords, perPage };
}

module.exports = {
  analyzeKeywords,
  tokenize,
  extractPhrases
};
