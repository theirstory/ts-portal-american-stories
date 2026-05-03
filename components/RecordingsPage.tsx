'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSemanticSearchStore } from '@/app/stores/useSemanticSearchStore';
import { SchemaTypes } from '@/types/weaviate';
import { SearchType } from '@/types/searchType';
import { PAGINATION_ITEMS_PER_PAGE } from '@/app/constants';
import CollectionLayout from './CollectionLayout';

const STORIES_RETURN_PROPERTIES = [
  'interview_title',
  'interview_description',
  'interview_duration',
  'ner_labels',
  'isAudioFile',
  'video_url',
  'collection_id',
  'collection_name',
  'collection_description',
] as const;

export const RecordingsPage = () => {
  const searchParams = useSearchParams();
  const collectionId = searchParams.get('collection');
  const initialQuery = searchParams.get('q')?.trim() ?? '';
  const requestedSearchType = searchParams.get('searchType') ?? '';

  const {
    getAllStories,
    loadCollections,
    loadFolders,
    setSelectedCollectionIds,
    setSelectedFolderIds,
    setCurrentPage,
    clearSearch,
    setHasSearched,
    setSearchTerm,
    setSearchType,
    runHybridSearch,
  } = useSemanticSearchStore();

  useEffect(() => {
    loadCollections();
    loadFolders();
  }, [loadCollections, loadFolders]);

  useEffect(() => {
    clearSearch();
    setHasSearched(false);
    setCurrentPage(1);
    setSelectedFolderIds([]);
    setSelectedCollectionIds(collectionId ? [collectionId] : []);

    if (initialQuery) {
      const type =
        requestedSearchType === SearchType.Vector
          ? SearchType.Vector
          : requestedSearchType === SearchType.bm25
            ? SearchType.bm25
            : SearchType.Hybrid;
      setSearchTerm(initialQuery);
      setSearchType(type);
      setHasSearched(true);
      runHybridSearch(SchemaTypes.Chunks, PAGINATION_ITEMS_PER_PAGE, 0, []);
    } else {
      setSearchTerm('');
      getAllStories(SchemaTypes.Testimonies, [...STORIES_RETURN_PROPERTIES], PAGINATION_ITEMS_PER_PAGE, 0);
    }
  }, [
    collectionId,
    initialQuery,
    requestedSearchType,
    clearSearch,
    getAllStories,
    runHybridSearch,
    setCurrentPage,
    setHasSearched,
    setSearchTerm,
    setSearchType,
    setSelectedCollectionIds,
    setSelectedFolderIds,
  ]);

  return <CollectionLayout />;
};
