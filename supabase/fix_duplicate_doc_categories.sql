-- Fix: Remove duplicate document categories (keeping only one of each code)
DELETE FROM ew_document_categories
WHERE id NOT IN (
  SELECT MIN(id) FROM ew_document_categories GROUP BY code
);
