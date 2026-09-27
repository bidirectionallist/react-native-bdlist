
import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useImperativeHandle,
  forwardRef,
  ReactNode,
} from 'react';
import {
  View,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ViewStyle,
  unstable_batchedUpdates,
} from 'react-native';
import { FlashList, ListRenderItemInfo } from '@shopify/flash-list';
import { ViewToken } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BDListItem { [key: string]: any }

export type BDDataSegment<T> =
  | { type: 'prepend'; data: T[] }
  | { type: 'append';  data: T[] };

export type BDData<T> = {
  type: 'append' | 'prepend';
  item: T;
  localIndex: number;
};

export interface BDScrollContext {
  active:         'append' | 'prepend';
  hasAppendData:  boolean;
  hasPrependData: boolean;
}

type MyRenderItemInfo<T> = ListRenderItemInfo<T> & {
  isAppend:   boolean;
  batchIndex: number;
};

export interface BDListHandle<T = BDListItem> {
  scrollToEnd:           (params?: { animated?: boolean }) => void;
  scrollToStart:         (params?: { animated?: boolean }) => void;
  scrollToOffset:        (params: { offset: number; animated?: boolean }) => void;
  scrollToIndex:         (params: { index: number; animated?: boolean; viewOffset?: number }) => void;
  scrollAppendToEnd:     (animated?: boolean) => void;
  scrollPrependToEnd:    (animated?: boolean) => void;
  scrollAppendToOffset:  (offset: number, animated?: boolean) => void;
  scrollPrependToOffset: (offset: number, animated?: boolean) => void;
  prepend:      (items: T[]) => void;
  append:       (items: T[]) => void;
  getAllData:   () => BDData<T>[];
  getData:      () => BDDataSegment<T>[];
  setData:      (items: T[]) => void;
  updateData:   (segments: BDData<T>[]) => void;
  setStateData: (callback: (segments: BDData<T>[]) => BDData<T>[]) => void;
  getActive:    () => 'append' | 'prepend';
  setActive:    (active: 'append' | 'prepend') => void;
  getContext:   () => BDScrollContext;
}

export interface BDListProps<T extends BDListItem> {
  initialData:              T[];
  extraData?:               any;
  renderItem:               (info: MyRenderItemInfo<T>) => React.ReactElement | null;
  keyExtractor?:            (item: T, index: number) => string;
  estimatedItemSize?:       number;
  uniqueBy?:                string;
  onStartReached?:          () => void;
  onEndReached?:            () => void;
  onStartReachedThreshold?: number;
  onEndReachedThreshold?:   number;
  onStartLeave?:            () => void;
  onEndLeave?:              () => void;
  onStartLeaveThreshold?:   number;
  onEndLeaveThreshold?:     number;
  onScroll?:                (e: NativeSyntheticEvent<NativeScrollEvent>, ctx: BDScrollContext) => void;
  onScrollBeginDrag?:       (ctx: BDScrollContext) => void;
  onScrollEndDrag?:         (ctx: BDScrollContext) => void;
  onMomentumScrollBegin?:   (ctx: BDScrollContext) => void;
  onMomentumScrollEnd?:     (ctx: BDScrollContext) => void;
  onViewableItemsChanged?:  (info: { viewableItems: ViewToken[]; changed: ViewToken[] }, ctx: BDScrollContext) => void;
  onContentSizeChange?:     (w: number, h: number, ctx: BDScrollContext) => void;
  onLoad?:                  (ctx: BDScrollContext) => void;
  onActiveChange?:          (active: 'append' | 'prepend') => void;
  onLayout?:                (ctx: BDScrollContext) => void;
  style?:                   ViewStyle;
  contentContainerStyle?:   ViewStyle;
  ListHeaderComponent?:     ReactNode | (() => ReactNode);
  ListFooterComponent?:     ReactNode | (() => ReactNode);
  ListEmptyComponent?:      ReactNode | (() => ReactNode);
  ItemSeparatorComponent?:  () => ReactNode;
  showsVerticalScrollIndicator?: boolean;
  decelerationRate?:        'normal' | 'fast' | number;
}

// ─── Component ────────────────────────────────────────────────────────────────

function BDListInner<T extends BDListItem>(
  props: BDListProps<T>,
  ref: React.ForwardedRef<BDListHandle<T>>,
) {
  const {
    initialData,
    extraData,
    renderItem,
    keyExtractor,
    estimatedItemSize       = 80,
    uniqueBy,
    onStartReached,
    onEndReached,
    onStartReachedThreshold = 0.3,
    onEndReachedThreshold   = 0.3,
    onStartLeave,
    onEndLeave,
    onStartLeaveThreshold,
    onEndLeaveThreshold,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onViewableItemsChanged,
    onContentSizeChange,
    onLoad,
    onActiveChange,
    onLayout,
    style,
    contentContainerStyle,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    ItemSeparatorComponent,
    showsVerticalScrollIndicator = true,
    decelerationRate             = 'normal',
  } = props;

  // ── data ─────────────────────────────────────────────────────────────────
  const [appendData,  setAppendData]  = useState<T[]>(initialData ?? []);
  const [prependData, setPrependData] = useState<T[]>([]);

  // ── dedup ─────────────────────────────────────────────────────────────────
  const seenKeys = useRef<Set<string>>(new Set(
    uniqueBy ? initialData.map(i => String(i[uniqueBy])) : []
  ));

  const filterDupes = useCallback((items: T[]): T[] => {
    if (!uniqueBy) return items;
    return items.filter(item => {
      const k = String(item[uniqueBy!]);
      if (seenKeys.current.has(k)) return false;
      seenKeys.current.add(k);
      return true;
    });
  }, [uniqueBy]);

  const resyncSeenKeys = useCallback((prepend: T[], append: T[]) => {
    if (!uniqueBy) return;
    seenKeys.current = new Set([...prepend, ...append].map(i => String(i[uniqueBy!])));
  }, [uniqueBy]);

  // ── focus ─────────────────────────────────────────────────────────────────
  const [active, setActiveState] = useState<'append' | 'prepend'>('append');
  const activeRef                = useRef<'append' | 'prepend'>('append');
  const momentumFlip             = useRef(false);

  const appendDataRef  = useRef(appendData);
  const prependDataRef = useRef(prependData);
  appendDataRef.current  = appendData;
  prependDataRef.current = prependData;

  const getCtx = useCallback((): BDScrollContext => ({
    active:         activeRef.current,
    hasAppendData:  appendDataRef.current.length > 0,
    hasPrependData: prependDataRef.current.length > 0,
  }), []);

  const flipActive = useCallback((to: 'append' | 'prepend', fromMomentum = false) => {
    if (activeRef.current === to) return;
    activeRef.current    = to;
    momentumFlip.current = fromMomentum;
    setActiveState(to);
    onActiveChange?.(to);
  }, [onActiveChange]);

  // ── heights ───────────────────────────────────────────────────────────────
  const [containerHeight, setContainerHeight] = useState(0);
  const [appendHeight,    setAppendHeight]    = useState(0);
  const containerHeightRef = useRef(0);
  const appendHeightRef    = useRef(0);
  const prependHeightRef   = useRef(0);

  // ── refs ──────────────────────────────────────────────────────────────────
  const appendListRef  = useRef<any>(null);
  const prependListRef = useRef<any>(null);

  // ── scroll helpers ────────────────────────────────────────────────────────
  //
  // Every programmatic scroll is TWO moves that must land in the SAME frame:
  // the target list moves, and the other list resets to 0 so the seam lines up.
  // Splitting them across frames (or into an effect) lets one settle before the
  // other, which reads as a jump.
  //
  // The append pane is the outer prepend list's ListHeaderComponent, so it is
  // only on screen when the outer list sits at 0. Without that reset the inner
  // scroll succeeds off-screen — indistinguishable from nothing happening.
  //
  // `run` receives the target list instance; it is null-safe, so a list that
  // has not mounted yet is simply skipped.

  const scrollAppend = useCallback((run: (list: any) => void) => {
    flipActive('append');                 // no-op when already active
    requestAnimationFrame(() => {
      prependListRef.current?.scrollToOffset({ offset: 0, animated: false });
      run(appendListRef.current);
    });
  }, [flipActive]);

  const scrollPrepend = useCallback((run: (list: any) => void) => {
    flipActive('prepend');
    requestAnimationFrame(() => {
      appendListRef.current?.scrollToOffset({ offset: 0, animated: false });
      run(prependListRef.current);
    });
  }, [flipActive]);

  // ── momentum kick ─────────────────────────────────────────────────────────
  //
  // Gesture flips only. momentumFlip is set exclusively by flipActive(to, true),
  // which no programmatic path calls — those all go through the helpers above.
  useEffect(() => {
    if (!momentumFlip.current) return;
    momentumFlip.current = false;
    requestAnimationFrame(() => {
      if (activeRef.current === 'append') {
        appendListRef.current?.scrollToOffset({ offset: 100, animated: true });
        prependListRef.current?.scrollToOffset({ offset: 0, animated: false });
      } else {
        prependListRef.current?.scrollToOffset({ offset: 100, animated: true });
        appendListRef.current?.scrollToOffset({ offset: 0, animated: false });
      }
    });
  }, [active]);

  // ── unified data ──────────────────────────────────────────────────────────
  const unifiedData = useMemo((): BDData<T>[] => {
    const result: BDData<T>[] = [];
    prependData.forEach((item, i) => result.push({ type: 'prepend', item, localIndex: i }));
    appendData.forEach((item,  i) => result.push({ type: 'append',  item, localIndex: i }));
    return result;
  }, [prependData, appendData]);

  const reversedPrepend = useMemo(() => [...prependData].reverse(), [prependData]);

  // ── threshold guards ──────────────────────────────────────────────────────
  const startReachedFired = useRef(false);
  const endReachedFired   = useRef(false);

  // ── stable renderItem wrappers ────────────────────────────────────────────
  const appendRenderItem = useCallback((info: ListRenderItemInfo<T>) =>
    renderItem({ ...info, index: info.index + prependDataRef.current.length, isAppend: true, batchIndex: info.index }),
  [renderItem]);

  const prependRenderItem = useCallback((info: ListRenderItemInfo<T>) =>
    renderItem({ ...info, index: info.index, isAppend: false, batchIndex: info.index }),
  [renderItem]);

  // ── append scroll handlers ────────────────────────────────────────────────
  const onAppendScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    onScroll?.(e, getCtx());

    if (contentOffset.y <= 0 && activeRef.current === 'append' && prependDataRef.current.length) {
      flipActive('prepend', true);
      return;
    }

    const fullOffset     = contentOffset.y + layoutMeasurement.height;
    const leaveEndThresh = contentSize.height - (appendHeightRef.current * (onEndLeaveThreshold ?? onEndReachedThreshold));
    if (fullOffset < leaveEndThresh && endReachedFired.current) {
      onEndLeave?.();
      endReachedFired.current = false;
    }

    if (!prependDataRef.current.length) {
      const ch    = containerHeightRef.current;
      const enter = ch * onStartReachedThreshold;
      const leave = ch * (onStartLeaveThreshold ?? onStartReachedThreshold);
      if (contentOffset.y > leave) {
        if (startReachedFired.current) onStartLeave?.();
        startReachedFired.current = false;
        return;
      }
      if (contentOffset.y <= enter && !startReachedFired.current) {
        startReachedFired.current = true;
        onStartReached?.();
      }
    }
  }, [onScroll, onStartReached, onStartLeave, onEndLeave,
      onStartReachedThreshold, onStartLeaveThreshold,
      onEndReachedThreshold, onEndLeaveThreshold, flipActive, getCtx]);

  const onAppendScrollBeginDrag = useCallback((_e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScrollBeginDrag?.(getCtx());
  }, [onScrollBeginDrag, getCtx]);

  const onAppendScrollEndDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScrollEndDrag?.(getCtx());
    if (e.nativeEvent.contentOffset.y <= 0 && activeRef.current === 'append' && prependDataRef.current.length) {
      flipActive('prepend', true);
    }
  }, [onScrollEndDrag, flipActive, getCtx]);

  const onAppendMomentumBegin = useCallback(() => {
    onMomentumScrollBegin?.(getCtx());
  }, [onMomentumScrollBegin, getCtx]);

  const onAppendMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onMomentumScrollEnd?.(getCtx());
    if (e.nativeEvent.contentOffset.y <= 0 && activeRef.current === 'append' && prependDataRef.current.length) {
      flipActive('prepend', true);
    }
  }, [onMomentumScrollEnd, flipActive, getCtx]);

  const onAppendViewable    = useCallback((info: any) => onViewableItemsChanged?.(info, getCtx()), [onViewableItemsChanged, getCtx]);
  const onAppendContentSize = useCallback((w: number, h: number) => onContentSizeChange?.(w, h, getCtx()), [onContentSizeChange, getCtx]);
  const onAppendLoad        = useCallback(() => onLoad?.(getCtx()), [onLoad, getCtx]);
  const onAppendEndReached  = useCallback(() => {
    if (appendDataRef.current.length) { endReachedFired.current = true; onEndReached?.(); }
  }, [onEndReached]);

  // ── prepend scroll handlers ───────────────────────────────────────────────
  const onPrependScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    onScroll?.(e, getCtx());

    if (contentOffset.y <= 0 && activeRef.current === 'prepend' && appendDataRef.current.length) {
      flipActive('append', true);
      return;
    }

    const fullOffset       = contentOffset.y + layoutMeasurement.height;
    const leaveStartThresh = contentSize.height - (containerHeightRef.current * (onStartLeaveThreshold ?? onStartReachedThreshold));
    if (fullOffset < leaveStartThresh && prependDataRef.current.length && startReachedFired.current) {
      onStartLeave?.();
      startReachedFired.current = false;
    }

    if (!appendDataRef.current.length) {
      const ch    = containerHeightRef.current;
      const enter = ch * onEndReachedThreshold;
      const leave = ch * (onEndLeaveThreshold ?? onEndReachedThreshold);
      if (contentOffset.y > leave) {
        if (endReachedFired.current) onEndLeave?.();
        endReachedFired.current = false;
        return;
      }
      if (contentOffset.y <= enter && !endReachedFired.current) {
        endReachedFired.current = true;
        onEndReached?.();
      }
    }
  }, [onScroll, onEndReached, onEndLeave, onStartLeave,
      onEndReachedThreshold, onEndLeaveThreshold,
      onStartReachedThreshold, onStartLeaveThreshold, flipActive, getCtx]);

  const onPrependScrollBeginDrag = useCallback((_e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScrollBeginDrag?.(getCtx());
  }, [onScrollBeginDrag, getCtx]);

  const onPrependScrollEndDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScrollEndDrag?.(getCtx());
    if (e.nativeEvent.contentOffset.y <= 0 && activeRef.current === 'prepend' && appendDataRef.current.length) {
      flipActive('append', true);
    }
  }, [onScrollEndDrag, flipActive, getCtx]);

  const onPrependMomentumBegin = useCallback(() => {
    onMomentumScrollBegin?.(getCtx());
  }, [onMomentumScrollBegin, getCtx]);

  const onPrependMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onMomentumScrollEnd?.(getCtx());
    if (e.nativeEvent.contentOffset.y <= 0 && activeRef.current === 'prepend' && appendDataRef.current.length) {
      flipActive('append', true);
    }
  }, [onMomentumScrollEnd, flipActive, getCtx]);

  const onPrependViewable    = useCallback((info: any) => onViewableItemsChanged?.(info, getCtx()), [onViewableItemsChanged, getCtx]);
  const onPrependContentSize = useCallback((w: number, h: number) => {
    prependHeightRef.current = h;
    onContentSizeChange?.(w, h, getCtx());
  }, [onContentSizeChange, getCtx]);
  const onPrependLoad        = useCallback(() => onLoad?.(getCtx()), [onLoad, getCtx]);
  const onPrependEndReached  = useCallback(() => {
    if (prependDataRef.current.length) { startReachedFired.current = true; onStartReached?.(); }
  }, [onStartReached]);

  // ── imperative handle ─────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    scrollToEnd: ({ animated = true } = {}) => {
      if (appendDataRef.current.length) {
        scrollAppend(l => l?.scrollToEnd({ animated }));
      } else {
        // inverted list: offset 0 is the newest end
        scrollPrepend(l => l?.scrollToOffset({ offset: 0, animated }));
      }
    },

    scrollToStart: ({ animated = true } = {}) => {
      if (prependDataRef.current.length) {
        scrollPrepend(l => l?.scrollToEnd({ animated }));
      } else {
        scrollAppend(l => l?.scrollToOffset({ offset: 0, animated }));
      }
    },

    scrollToOffset: ({ offset, animated = true }) => {
      if (offset >= prependHeightRef.current && appendDataRef.current.length) {
        scrollAppend(l => l?.scrollToOffset({ offset: offset - prependHeightRef.current, animated }));
      } else if (prependDataRef.current.length) {
        scrollPrepend(l => l?.scrollToOffset({
          offset: Math.max(0, prependHeightRef.current - offset),
          animated,
        }));
      } else {
        scrollAppend(l => l?.scrollToOffset({ offset: 0, animated }));
      }
    },

    scrollToIndex: ({ index, animated = true, viewOffset }) => {
      const entry = unifiedData[index];
      if (!entry) return;
      if (entry.type === 'append') {
        scrollAppend(l => l?.scrollToIndex({ index: entry.localIndex, animated, viewOffset }));
      } else {
        const inv = prependDataRef.current.length - 1 - entry.localIndex;
        scrollPrepend(l => l?.scrollToIndex({ index: inv, animated, viewOffset }));
      }
    },

    scrollAppendToEnd:     (animated = true) => scrollAppend(l => l?.scrollToEnd({ animated })),
    scrollPrependToEnd:    (animated = true) => scrollPrepend(l => l?.scrollToEnd({ animated })),
    scrollAppendToOffset:  (offset, animated = true) => scrollAppend(l => l?.scrollToOffset({ offset, animated })),
    scrollPrependToOffset: (offset, animated = true) => scrollPrepend(l => l?.scrollToOffset({ offset, animated })),

    prepend: (items: T[]) => {
      const filtered = filterDupes(items);
      if (!filtered.length) return;
      if (!prependDataRef.current.length && !appendDataRef.current.length) {
        setAppendData(filtered); return;
      }
      setPrependData(prev => [...filtered, ...prev]);
    },

    append: (items: T[]) => {
      const filtered = filterDupes(items);
      if (!filtered.length) return;
      setAppendData(prev => [...prev, ...filtered]);
    },

    getAllData: () => unifiedData,
    getData:    () => [
      { type: 'prepend' as const, data: prependDataRef.current },
      { type: 'append'  as const, data: appendDataRef.current  },
    ],

    setData: (items: T[]) => {
      seenKeys.current = new Set();
      unstable_batchedUpdates(() => {
        setPrependData([]);
        setAppendData(filterDupes(items));
        flipActive('append');
      });
    },

    updateData: (segments: BDData<T>[]) => {
      const np = segments.filter(e => e.type === 'prepend').map(e => e.item);
      const na = segments.filter(e => e.type === 'append').map(e => e.item);
      resyncSeenKeys(np, na);
      unstable_batchedUpdates(() => { setPrependData(np); setAppendData(na); });
    },

    setStateData: (callback: (segments: BDData<T>[]) => BDData<T>[]) => {
      const segs = callback(unifiedData);
      const np   = segs.filter(e => e.type === 'prepend').map(e => e.item);
      const na   = segs.filter(e => e.type === 'append').map(e => e.item);
      resyncSeenKeys(np, na);
      unstable_batchedUpdates(() => { setPrependData(np); setAppendData(na); });
    },

    getActive: () => activeRef.current,
    // routed through the helpers so the target pane is revealed, not just focused
    setActive: (a: 'append' | 'prepend') =>
      a === 'append' ? scrollAppend(() => {}) : scrollPrepend(() => {}),
    getContext: () => getCtx(),
  }));

  // ── render helpers ────────────────────────────────────────────────────────
  const wrapNode = useCallback((c: ReactNode | (() => ReactNode) | undefined) => {
    if (!c) return undefined;
    const node = typeof c === 'function' ? (c as () => ReactNode)() : c;
    return () => <>{node}</>;
  }, []);

  const hasPrepend = prependData.length > 0;
  const hasAppend  = appendData.length  > 0;

  const headerForPrepend = useMemo(() => hasPrepend ? wrapNode(ListHeaderComponent) : undefined,
    [hasPrepend, ListHeaderComponent, wrapNode]);
  const headerForAppend  = useMemo(() => !hasPrepend ? wrapNode(ListHeaderComponent) : undefined,
    [hasPrepend, ListHeaderComponent, wrapNode]);
  const FooterForAppend  = useMemo(() => hasAppend ? wrapNode(ListFooterComponent) : undefined,
    [hasAppend, ListFooterComponent, wrapNode]);
  const EmptyComponent   = useMemo(() => wrapNode(ListEmptyComponent),
    [ListEmptyComponent, wrapNode]);

  // ── AppendHeader — stable function ref, reads fresh props every call ──────
  //
  // AppendHeader is the SAME function reference forever (created once via
  // useRef). When the parent prepend FlashList re-renders due to
  // combinedExtraData changing, it calls AppendHeader() again — which reads the
  // latest props from appendHeaderPropsRef.current. This is a re-render (React
  // diffs), NOT a remount. Scroll position is preserved.

  const appendHeaderPropsRef = useRef<any>({});
  appendHeaderPropsRef.current = {
    show:              containerHeight > 0 && hasAppend,
    height:            appendHeight || containerHeight,
    maxHeight:         containerHeight,
    extraData,
    data:              appendData,
    renderItem:        appendRenderItem,
    keyExtractor,
    estimatedItemSize,
    scrollEnabled:     active === 'append',
    showsVSI:          showsVerticalScrollIndicator && active === 'append',
    contentContainerStyle,
    decelerationRate,
    onScroll:          onAppendScroll,
    onScrollBeginDrag: onAppendScrollBeginDrag,
    onScrollEndDrag:   onAppendScrollEndDrag,
    onMomentumBegin:   onAppendMomentumBegin,
    onMomentumEnd:     onAppendMomentumEnd,
    onViewable:        onAppendViewable,
    onContentSize:     onAppendContentSize,
    onLoad:            onAppendLoad,
    onEndReached:      onAppendEndReached,
    onEndReachedThreshold,
    ListHeaderComponent: headerForAppend,
    ListFooterComponent: FooterForAppend,
    ListEmptyComponent:  EmptyComponent,
    ItemSeparatorComponent,
  };

  const AppendHeader = useRef(() => {
    const p = appendHeaderPropsRef.current;
    if (!p.show) return null;
    return (
      <View style={{ height: p.height, maxHeight: p.maxHeight, backgroundColor: '#cd0e0eff' }}>
        <FlashList
          ref={appendListRef}
          extraData={p.extraData}
          data={p.data}
          renderItem={p.renderItem}
          keyExtractor={p.keyExtractor}
          estimatedItemSize={p.estimatedItemSize}
          scrollEnabled={p.scrollEnabled}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={p.showsVSI}
          contentContainerStyle={p.contentContainerStyle}
          decelerationRate={p.decelerationRate}
          onScroll={p.onScroll}
          onScrollBeginDrag={p.onScrollBeginDrag}
          onScrollEndDrag={p.onScrollEndDrag}
          onMomentumScrollBegin={p.onMomentumBegin}
          onMomentumScrollEnd={p.onMomentumEnd}
          onViewableItemsChanged={p.onViewable}
          onContentSizeChange={p.onContentSize}
          onLoad={p.onLoad}
          onEndReached={p.onEndReached}
          onEndReachedThreshold={p.onEndReachedThreshold}
          ListHeaderComponent={p.ListHeaderComponent}
          ListFooterComponent={p.ListFooterComponent}
          ListEmptyComponent={p.ListEmptyComponent}
          ItemSeparatorComponent={p.ItemSeparatorComponent}
        />
      </View>
    );
  }).current;

  // combinedExtraData — any data change triggers the prepend FlashList to
  // re-render its ListHeaderComponent (AppendHeader). Since AppendHeader is a
  // stable ref, this is a re-render not a remount — scroll position preserved.
  const combinedExtraData = useMemo(() => ({
    extraData,
    appendData,
    prependData,
    active,
    appendHeight,
    containerHeight,
  }), [extraData, appendData, prependData, active, appendHeight, containerHeight]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <View
      style={[styles.container, style]}
      onLayout={e => {
        const h = e.nativeEvent.layout.height;
        if (h !== containerHeight) {
          containerHeightRef.current = h;
          setContainerHeight(h);
          setAppendHeight(h);
          appendHeightRef.current = h;
        }
        onLayout?.(getCtx());
      }}
    >
      <FlashList
        ref={prependListRef}
        inverted
        data={reversedPrepend}
        renderItem={prependRenderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={estimatedItemSize}
        scrollEnabled={active === 'prepend'}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator && active === 'prepend'}
        contentContainerStyle={contentContainerStyle}
        decelerationRate={decelerationRate}
        extraData={combinedExtraData}
        onScroll={onPrependScroll}
        onScrollBeginDrag={onPrependScrollBeginDrag}
        onScrollEndDrag={onPrependScrollEndDrag}
        onMomentumScrollBegin={onPrependMomentumBegin}
        onMomentumScrollEnd={onPrependMomentumEnd}
        onViewableItemsChanged={onPrependViewable}
        onContentSizeChange={onPrependContentSize}
        onLoad={onPrependLoad}
        onEndReached={onPrependEndReached}
        onEndReachedThreshold={onStartReachedThreshold}
        ListHeaderComponent={AppendHeader}
        ListFooterComponent={headerForPrepend}
        ItemSeparatorComponent={ItemSeparatorComponent}
      />
    </View>
  );
}

// ─── forwardRef wrapper ───────────────────────────────────────────────────────

const BiDirectionalList = forwardRef(BDListInner) as <T extends BDListItem>(
  props: BDListProps<T> & { ref?: React.ForwardedRef<BDListHandle<T>> },
) => ReturnType<typeof BDListInner>;

export default BiDirectionalList;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
});












































































// import React, {
//   useRef,
//   useState,
//   useCallback,
//   useEffect,
//   useMemo,
//   useImperativeHandle,
//   forwardRef,
//   ReactNode,
// } from 'react';
// import {
//   View,
//   StyleSheet,
//   NativeSyntheticEvent,
//   NativeScrollEvent,
//   ViewStyle,
//   unstable_batchedUpdates,
// } from 'react-native';
// import { FlashList, ListRenderItemInfo, ViewToken } from '@shopify/flash-list';

// // ─── Types ────────────────────────────────────────────────────────────────────

// export interface BDListItem { [key: string]: any }

// export type BDDataSegment<T> =
//   | { type: 'prepend'; data: T[] }
//   | { type: 'append';  data: T[] };

// export type BDData<T> = {
//   type: 'append' | 'prepend';
//   item: T;
//   localIndex: number;
// };

// export interface BDScrollContext {
//   active:         'append' | 'prepend';
//   hasAppendData:  boolean;
//   hasPrependData: boolean;
// }

// type ScrollPos = 'start' | 'end' | 'top' | 'offset';

// interface ScrollIntent {
//   scroll:    boolean;
//   animated?: boolean;
//   position:  ScrollPos;
//   offset?:   number;
// }

// type MyRenderItemInfo<T> = ListRenderItemInfo<T> & {
//   isAppend:   boolean;
//   batchIndex: number;
// };

// export interface BDListHandle<T = BDListItem> {
//   scrollToEnd:           (params?: { animated?: boolean }) => void;
//   scrollToStart:         (params?: { animated?: boolean }) => void;
//   scrollToOffset:        (params: { offset: number; animated?: boolean }) => void;
//   scrollToIndex:         (params: { index: number; animated?: boolean; viewOffset?: number }) => void;
//   scrollAppendToEnd:     (animated?: boolean) => void;
//   scrollPrependToEnd:    (animated?: boolean) => void;
//   scrollAppendToOffset:  (offset: number, animated?: boolean) => void;
//   scrollPrependToOffset: (offset: number, animated?: boolean) => void;
//   prepend:      (items: T[]) => void;
//   append:       (items: T[]) => void;
//   getAllData:    () => BDData<T>[];
//   getData:      () => BDDataSegment<T>[];
//   setData:      (items: T[]) => void;
//   updateData:   (segments: BDData<T>[]) => void;
//   setStateData: (callback: (segments: BDData<T>[]) => BDData<T>[]) => void;
//   getActive:    () => 'append' | 'prepend';
//   setActive:    (active: 'append' | 'prepend') => void;
//   getContext:   () => BDScrollContext;
// }

// export interface BDListProps<T extends BDListItem> {
//   initialData:              T[];
//   extraData?:               any;
//   renderItem:               (info: MyRenderItemInfo<T>) => React.ReactElement | null;
//   keyExtractor?:            (item: T, index: number) => string;
//   estimatedItemSize?:       number;
//   uniqueBy?:                string;
//   onStartReached?:          () => void;
//   onEndReached?:            () => void;
//   onStartReachedThreshold?: number;
//   onEndReachedThreshold?:   number;
//   onStartLeave?:            () => void;
//   onEndLeave?:              () => void;
//   onStartLeaveThreshold?:   number;
//   onEndLeaveThreshold?:     number;
//   onScroll?:                (e: NativeSyntheticEvent<NativeScrollEvent>, ctx: BDScrollContext) => void;
//   onScrollBeginDrag?:       (ctx: BDScrollContext) => void;
//   onScrollEndDrag?:         (ctx: BDScrollContext) => void;
//   onMomentumScrollBegin?:   (ctx: BDScrollContext) => void;
//   onMomentumScrollEnd?:     (ctx: BDScrollContext) => void;
//   // onViewableItemsChanged?:  (info: { viewableItems: ViewToken[]; changed: ViewToken[] }, ctx: BDScrollContext) => void;
//   onViewableItemsChanged?: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }, ctx: BDScrollContext) => void;
//   onContentSizeChange?:     (w: number, h: number, ctx: BDScrollContext) => void;
//   onLoad?:                  (ctx: BDScrollContext) => void;
//   onActiveChange?:          (active: 'append' | 'prepend') => void;
//   onLayout?:                (ctx: BDScrollContext) => void;
//   style?:                   ViewStyle;
//   contentContainerStyle?:   ViewStyle;
//   ListHeaderComponent?:     ReactNode | (() => ReactNode);
//   ListFooterComponent?:     ReactNode | (() => ReactNode);
//   ListEmptyComponent?:      ReactNode | (() => ReactNode);
//   ItemSeparatorComponent?:  () => ReactNode;
//   showsVerticalScrollIndicator?: boolean;
//   decelerationRate?:        'normal' | 'fast' | number;
// }

// // ─── Component ────────────────────────────────────────────────────────────────

// function BDListInner<T extends BDListItem>(
//   props: BDListProps<T>,
//   ref: React.ForwardedRef<BDListHandle<T>>,
// ) {
//   const {
//     initialData,
//     extraData,
//     renderItem,
//     keyExtractor,
//     estimatedItemSize       = 80,
//     uniqueBy,
//     onStartReached,
//     onEndReached,
//     onStartReachedThreshold = 0.3,
//     onEndReachedThreshold   = 0.3,
//     onStartLeave,
//     onEndLeave,
//     onStartLeaveThreshold,
//     onEndLeaveThreshold,
//     onScroll,
//     onScrollBeginDrag,
//     onScrollEndDrag,
//     onMomentumScrollBegin,
//     onMomentumScrollEnd,
//     onViewableItemsChanged,
//     onContentSizeChange,
//     onLoad,
//     onActiveChange,
//     onLayout,
//     style,
//     contentContainerStyle,
//     ListHeaderComponent,
//     ListFooterComponent,
//     ListEmptyComponent,
//     ItemSeparatorComponent,
//     showsVerticalScrollIndicator = true,
//     decelerationRate             = 'normal',
//   } = props;

//   // ── data ─────────────────────────────────────────────────────────────────
//   const [appendData,  setAppendData]  = useState<T[]>(initialData ?? []);
//   const [prependData, setPrependData] = useState<T[]>([]);

//   // ── dedup ─────────────────────────────────────────────────────────────────
//   const seenKeys = useRef<Set<string>>(new Set(
//     uniqueBy ? initialData.map(i => String(i[uniqueBy])) : []
//   ));

//   const filterDupes = useCallback((items: T[]): T[] => {
//     if (!uniqueBy) return items;
//     return items.filter(item => {
//       const k = String(item[uniqueBy!]);
//       if (seenKeys.current.has(k)) return false;
//       seenKeys.current.add(k);
//       return true;
//     });
//   }, [uniqueBy]);

//   const resyncSeenKeys = useCallback((prepend: T[], append: T[]) => {
//     if (!uniqueBy) return;
//     seenKeys.current = new Set([...prepend, ...append].map(i => String(i[uniqueBy!])));
//   }, [uniqueBy]);

//   // ── focus ─────────────────────────────────────────────────────────────────
//   const [active, setActiveState] = useState<'append' | 'prepend'>('append');
//   const activeRef                = useRef<'append' | 'prepend'>('append');
//   const momentumFlip             = useRef(false);

//   const appendDataRef  = useRef(appendData);
//   const prependDataRef = useRef(prependData);
//   appendDataRef.current  = appendData;
//   prependDataRef.current = prependData;

//   const getCtx = useCallback((): BDScrollContext => ({
//     active:         activeRef.current,
//     hasAppendData:  appendDataRef.current.length > 0,
//     hasPrependData: prependDataRef.current.length > 0,
//   }), []);

//   const flipActive = useCallback((to: 'append' | 'prepend', fromMomentum = false) => {
//     if (activeRef.current === to) return;
//     activeRef.current    = to;
//     momentumFlip.current = fromMomentum;
//     setActiveState(to);
//     onActiveChange?.(to);
//   }, [onActiveChange]);

//   // ── heights ───────────────────────────────────────────────────────────────
//   const [containerHeight, setContainerHeight] = useState(0);
//   const [appendHeight,    setAppendHeight]    = useState(0);
//   const containerHeightRef = useRef(0);
//   const appendHeightRef    = useRef(0);
//   const prependHeightRef   = useRef(0);

//   // ── refs ──────────────────────────────────────────────────────────────────
//   const appendListRef  = useRef<FlashList<T>>(null);
//   const prependListRef = useRef<FlashList<T>>(null);
// //   const appendListRef  = useRef<FlashListRef<T>>(null);
// // const prependListRef = useRef<FlashListRef<T>>(null);

//   const intentInit: ScrollIntent = { scroll: false, position: 'start' };
//   const prependScrollIntent      = useRef<ScrollIntent>(intentInit);
//   const appendScrollIntent       = useRef<ScrollIntent>(intentInit);

//   // ── momentum kick ─────────────────────────────────────────────────────────
//   useEffect(() => {
//     if (!momentumFlip.current) return;
//     momentumFlip.current = false;
//     requestAnimationFrame(() => {
//       if (activeRef.current === 'append') {
//         appendListRef.current?.scrollToOffset({ offset: 100, animated: true });
//         prependListRef.current?.scrollToOffset({ offset: 0, animated: false });
//       } else {
//         prependListRef.current?.scrollToOffset({ offset: 100, animated: true });
//         appendListRef.current?.scrollToOffset({ offset: 0, animated: false });
//       }
//     });
//   }, [active]);

//   // ── unified data ──────────────────────────────────────────────────────────
//   const unifiedData = useMemo((): BDData<T>[] => {
//     const result: BDData<T>[] = [];
//     prependData.forEach((item, i) => result.push({ type: 'prepend', item, localIndex: i }));
//     appendData.forEach((item,  i) => result.push({ type: 'append',  item, localIndex: i }));
//     return result;
//   }, [prependData, appendData]);

//   const reversedPrepend = useMemo(() => [...prependData].reverse(), [prependData]);

//   // ── threshold guards ──────────────────────────────────────────────────────
//   const startReachedFired = useRef(false);
//   const endReachedFired   = useRef(false);

//   // ── stable renderItem wrappers ────────────────────────────────────────────
//   const appendRenderItem = useCallback((info: ListRenderItemInfo<T>) =>
//     renderItem({ ...info, index: info.index + prependDataRef.current.length, isAppend: true, batchIndex: info.index }),
//   [renderItem]);

//   const prependRenderItem = useCallback((info: ListRenderItemInfo<T>) =>
//     renderItem({ ...info, index: info.index, isAppend: false, batchIndex: info.index }),
//   [renderItem]);

//   // ── append scroll handlers ────────────────────────────────────────────────
//   const onAppendScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
//     const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
//     onScroll?.(e, getCtx());

//     if (contentOffset.y <= 0 && activeRef.current === 'append' && prependDataRef.current.length) {
//       flipActive('prepend', true);
//       return;
//     }

//     const fullOffset     = contentOffset.y + layoutMeasurement.height;
//     const leaveEndThresh = contentSize.height - (appendHeightRef.current * (onEndLeaveThreshold ?? onEndReachedThreshold));
//     if (fullOffset < leaveEndThresh && endReachedFired.current) {
//       onEndLeave?.();
//       endReachedFired.current = false;
//     }

//     if (!prependDataRef.current.length) {
//       const ch    = containerHeightRef.current;
//       const enter = ch * onStartReachedThreshold;
//       const leave = ch * (onStartLeaveThreshold ?? onStartReachedThreshold);
//       if (contentOffset.y > leave) {
//         if (startReachedFired.current) onStartLeave?.();
//         startReachedFired.current = false;
//         return;
//       }
//       if (contentOffset.y <= enter && !startReachedFired.current) {
//         startReachedFired.current = true;
//         onStartReached?.();
//       }
//     }
//   }, [onScroll, onStartReached, onStartLeave, onEndLeave,
//       onStartReachedThreshold, onStartLeaveThreshold,
//       onEndReachedThreshold, onEndLeaveThreshold, flipActive, getCtx]);

//   const onAppendScrollBeginDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
//     appendScrollIntent.current = intentInit;
//     onScrollBeginDrag?.(getCtx());
//   }, [onScrollBeginDrag, getCtx]);

//   const onAppendScrollEndDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
//     onScrollEndDrag?.(getCtx());
//     if (e.nativeEvent.contentOffset.y <= 0 && activeRef.current === 'append' && prependDataRef.current.length) {
//       flipActive('prepend', true);
//     }
//   }, [onScrollEndDrag, flipActive, getCtx]);

//   const onAppendMomentumBegin = useCallback(() => {
//     prependScrollIntent.current = intentInit;
//     onMomentumScrollBegin?.(getCtx());
//   }, [onMomentumScrollBegin, getCtx]);

//   const onAppendMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
//     const intent = appendScrollIntent.current;
//     if (intent.scroll && intent.position === 'top' && prependDataRef.current.length) {
//       requestAnimationFrame(() => {
//         flipActive('prepend');
//         prependListRef.current?.scrollToEnd({ animated: intent.animated });
//       });
//       appendScrollIntent.current = intentInit;
//     }
//     onMomentumScrollEnd?.(getCtx());
//     if (e.nativeEvent.contentOffset.y <= 0 && activeRef.current === 'append' && prependDataRef.current.length) {
//       flipActive('prepend', true);
//     }
//   }, [onMomentumScrollEnd, flipActive, getCtx]);

//   const onAppendViewable    = useCallback((info: any) => onViewableItemsChanged?.(info, getCtx()), [onViewableItemsChanged, getCtx]);
//   const onAppendContentSize = useCallback((w: number, h: number) => onContentSizeChange?.(w, h, getCtx()), [onContentSizeChange, getCtx]);
//   const onAppendLoad        = useCallback(() => onLoad?.(getCtx()), [onLoad, getCtx]);
//   const onAppendEndReached  = useCallback(() => {
//     if (appendDataRef.current.length) { endReachedFired.current = true; onEndReached?.(); }
//   }, [onEndReached]);

//   // ── prepend scroll handlers ───────────────────────────────────────────────
//   const onPrependScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
//     const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
//     onScroll?.(e, getCtx());

//     if (contentOffset.y <= 0 && activeRef.current === 'prepend' && appendDataRef.current.length) {
//       flipActive('append', true);
//       return;
//     }

//     const fullOffset       = contentOffset.y + layoutMeasurement.height;
//     const leaveStartThresh = contentSize.height - (containerHeightRef.current * (onStartLeaveThreshold ?? onStartReachedThreshold));
//     if (fullOffset < leaveStartThresh && prependDataRef.current.length && startReachedFired.current) {
//       onStartLeave?.();
//       startReachedFired.current = false;
//     }

//     if (!appendDataRef.current.length) {
//       const ch    = containerHeightRef.current;
//       const enter = ch * onEndReachedThreshold;
//       const leave = ch * (onEndLeaveThreshold ?? onEndReachedThreshold);
//       if (contentOffset.y > leave) {
//         if (endReachedFired.current) onEndLeave?.();
//         endReachedFired.current = false;
//         return;
//       }
//       if (contentOffset.y <= enter && !endReachedFired.current) {
//         endReachedFired.current = true;
//         onEndReached?.();
//       }
//     }
//   }, [onScroll, onEndReached, onEndLeave, onStartLeave,
//       onEndReachedThreshold, onEndLeaveThreshold,
//       onStartReachedThreshold, onStartLeaveThreshold, flipActive, getCtx]);

//   const onPrependScrollBeginDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
//     prependScrollIntent.current = intentInit;
//     onScrollBeginDrag?.(getCtx());
//   }, [onScrollBeginDrag, getCtx]);

//   const onPrependScrollEndDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
//     onScrollEndDrag?.(getCtx());
//     if (e.nativeEvent.contentOffset.y <= 0 && activeRef.current === 'prepend' && appendDataRef.current.length) {
//       flipActive('append', true);
//     }
//   }, [onScrollEndDrag, flipActive, getCtx]);

//   const onPrependMomentumBegin = useCallback(() => {
//     appendScrollIntent.current = intentInit;
//     onMomentumScrollBegin?.(getCtx());
//   }, [onMomentumScrollBegin, getCtx]);

//   const onPrependMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
//     const intent = prependScrollIntent.current;
//     if (intent.scroll && intent.position === 'end' && appendDataRef.current.length) {
//       requestAnimationFrame(() => {
//         flipActive('append');
//         appendListRef.current?.scrollToEnd({ animated: intent.animated });
//       });
//       prependScrollIntent.current = intentInit;
//     }
//     onMomentumScrollEnd?.(getCtx());
//     if (e.nativeEvent.contentOffset.y <= 0 && activeRef.current === 'prepend' && appendDataRef.current.length) {
//       flipActive('append', true);
//     }
//   }, [onMomentumScrollEnd, flipActive, getCtx]);

//   const onPrependViewable    = useCallback((info: any) => onViewableItemsChanged?.(info, getCtx()), [onViewableItemsChanged, getCtx]);
//   const onPrependContentSize = useCallback((w: number, h: number) => {
//     prependHeightRef.current = h;
//     onContentSizeChange?.(w, h, getCtx());
//   }, [onContentSizeChange, getCtx]);
//   const onPrependLoad        = useCallback(() => onLoad?.(getCtx()), [onLoad, getCtx]);
//   const onPrependEndReached  = useCallback(() => {
//     if (prependDataRef.current.length) { startReachedFired.current = true; onStartReached?.(); }
//   }, [onStartReached]);

//   // ── imperative handle ─────────────────────────────────────────────────────
//   useImperativeHandle(ref, () => ({
//     scrollToEnd: ({ animated = true } = {}) => {
//       if (!appendDataRef.current.length) {
//         flipActive('prepend');
//         requestAnimationFrame(() => prependListRef.current?.scrollToOffset({ offset: 0, animated }));
//         return;
//       }
//       if (activeRef.current === 'prepend') {
//         prependScrollIntent.current = { scroll: true, animated, position: 'end' };
//         prependListRef.current?.scrollToOffset({ offset: 0, animated });
//       } else {
//         flipActive('append');
//         requestAnimationFrame(() => appendListRef.current?.scrollToEnd({ animated }));
//       }
//     },

//     scrollToStart: ({ animated = true } = {}) => {
//       if (!prependDataRef.current.length) {
//         flipActive('append');
//         requestAnimationFrame(() => appendListRef.current?.scrollToOffset({ offset: 0, animated }));
//         return;
//       }
//       if (activeRef.current === 'append') {
//         appendScrollIntent.current = { scroll: true, animated, position: 'top' };
//         appendListRef.current?.scrollToOffset({ offset: 0, animated });
//       } else {
//         flipActive('prepend');
//         requestAnimationFrame(() => prependListRef.current?.scrollToEnd({ animated }));
//       }
//     },

//     scrollToOffset: ({ offset, animated = true }) => {
//       if (offset >= prependHeightRef.current) {
//         if (appendDataRef.current.length) {
//           flipActive('append');
//           requestAnimationFrame(() =>
//             appendListRef.current?.scrollToOffset({ offset: offset - prependHeightRef.current, animated }));
//         } else {
//           prependListRef.current?.scrollToEnd({ animated });
//         }
//       } else {
//         flipActive('prepend');
//         requestAnimationFrame(() => {
//           if (prependDataRef.current.length) {
//             prependListRef.current?.scrollToOffset({ offset: prependHeightRef.current - offset, animated });
//           } else {
//             appendListRef.current?.scrollToOffset({ offset: 0, animated });
//           }
//         });
//       }
//     },

//     scrollToIndex: ({ index, animated = true, viewOffset }) => {
//       const entry = unifiedData[index];
//       if (!entry) return;
//       if (entry.type === 'append') {
//         flipActive('append');
//         requestAnimationFrame(() =>
//           appendListRef.current?.scrollToIndex({ index: entry.localIndex, animated, viewOffset }));
//       } else {
//         const inv = prependDataRef.current.length - 1 - entry.localIndex;
//         flipActive('prepend');
//         requestAnimationFrame(() =>
//           prependListRef.current?.scrollToIndex({ index: inv, animated, viewOffset }));
//       }
//     },

//     scrollAppendToEnd:     (animated = true) => appendListRef.current?.scrollToEnd({ animated }),
//     scrollPrependToEnd:    (animated = true) => prependListRef.current?.scrollToEnd({ animated }),
//     scrollAppendToOffset:  (offset, animated = true) => appendListRef.current?.scrollToOffset({ offset, animated }),
//     scrollPrependToOffset: (offset, animated = true) => prependListRef.current?.scrollToOffset({ offset, animated }),

//     prepend: (items: T[]) => {
//       const filtered = filterDupes(items);
//       if (!filtered.length) return;
//       if (!prependDataRef.current.length && !appendDataRef.current.length) {
//         setAppendData(filtered); return;
//       }
//       setPrependData(prev => [...filtered, ...prev]);
//     },

//     append: (items: T[]) => {
//       const filtered = filterDupes(items);
//       if (!filtered.length) return;
//       setAppendData(prev => [...prev, ...filtered]);
//     },

//     getAllData:  () => unifiedData,
//     getData:    () => [
//       { type: 'prepend' as const, data: prependDataRef.current },
//       { type: 'append'  as const, data: appendDataRef.current  },
//     ],

//     setData: (items: T[]) => {
//       seenKeys.current = new Set();
//       unstable_batchedUpdates(() => {
//         setPrependData([]);
//         setAppendData(filterDupes(items));
//         flipActive('append');
//       });
//     },

//     updateData: (segments: BDData<T>[]) => {
//       const np = segments.filter(e => e.type === 'prepend').map(e => e.item);
//       const na = segments.filter(e => e.type === 'append').map(e => e.item);
//       resyncSeenKeys(np, na);
//       unstable_batchedUpdates(() => { setPrependData(np); setAppendData(na); });
//     },

//     setStateData: (callback: (segments: BDData<T>[]) => BDData<T>[]) => {
//       const segs = callback(unifiedData);
//       const np   = segs.filter(e => e.type === 'prepend').map(e => e.item);
//       const na   = segs.filter(e => e.type === 'append').map(e => e.item);
//       resyncSeenKeys(np, na);
//       unstable_batchedUpdates(() => { setPrependData(np); setAppendData(na); });
//     },

//     getActive:  () => activeRef.current,
//     setActive:  (a: 'append' | 'prepend') => flipActive(a),
//     getContext: () => getCtx(),
//   }));

//   // ── render helpers ────────────────────────────────────────────────────────
//   const wrapNode = useCallback((c: ReactNode | (() => ReactNode) | undefined) => {
//     if (!c) return undefined;
//     const node = typeof c === 'function' ? (c as () => ReactNode)() : c;
//     return () => <>{node}</>;
//   }, []);

//   const hasPrepend = prependData.length > 0;
//   const hasAppend  = appendData.length  > 0;

//   const headerForPrepend = useMemo(() => hasPrepend ? wrapNode(ListHeaderComponent) : undefined,
//     [hasPrepend, ListHeaderComponent, wrapNode]);
//   const headerForAppend  = useMemo(() => !hasPrepend ? wrapNode(ListHeaderComponent) : undefined,
//     [hasPrepend, ListHeaderComponent, wrapNode]);
//   const FooterForAppend  = useMemo(() => hasAppend ? wrapNode(ListFooterComponent) : undefined,
//     [hasAppend, ListFooterComponent, wrapNode]);
//   const EmptyComponent   = useMemo(() => wrapNode(ListEmptyComponent),
//     [ListEmptyComponent, wrapNode]);

//   // ── AppendHeader — stable function ref, reads fresh props every call ──────
//   //
//   // The key insight: AppendHeader is the SAME function reference forever
//   // (created once via useRef). When the parent prepend FlashList re-renders
//   // due to combinedExtraData changing, it calls AppendHeader() again —
//   // which reads the latest props from appendHeaderPropsRef.current.
//   // This is a re-render (React diffs), NOT a remount (no destroy/recreate).
//   // Scroll position is preserved. Only changed items update.

//   const appendHeaderPropsRef = useRef<any>({});
//   appendHeaderPropsRef.current = {
//     show:              containerHeight > 0 && hasAppend,
//     height:            appendHeight || containerHeight,
//     maxHeight:         containerHeight,
//     extraData,
//     data:              appendData,
//     renderItem:        appendRenderItem,
//     keyExtractor,
//     estimatedItemSize,
//     scrollEnabled:     active === 'append',
//     showsVSI:          showsVerticalScrollIndicator && active === 'append',
//     contentContainerStyle,
//     decelerationRate,
//     onScroll:          onAppendScroll,
//     onScrollBeginDrag: onAppendScrollBeginDrag,
//     onScrollEndDrag:   onAppendScrollEndDrag,
//     onMomentumBegin:   onAppendMomentumBegin,
//     onMomentumEnd:     onAppendMomentumEnd,
//     onViewable:        onAppendViewable,
//     onContentSize:     onAppendContentSize,
//     onLoad:            onAppendLoad,
//     onEndReached:      onAppendEndReached,
//     onEndReachedThreshold,
//     ListHeaderComponent: headerForAppend,
//     ListFooterComponent: FooterForAppend,
//     ListEmptyComponent:  EmptyComponent,
//     ItemSeparatorComponent,
//   };

//   const AppendHeader = useRef(() => {
//     const p = appendHeaderPropsRef.current;
//     if (!p.show) return null;
//     return (
//       <View style={{ height: p.height, maxHeight: p.maxHeight }}>
//         <FlashList
//           ref={appendListRef}
//           extraData={p.extraData}
//           data={p.data}
//           renderItem={p.renderItem}
//           keyExtractor={p.keyExtractor}
          
//           estimatedItemSize={p.estimatedItemSize}
//           scrollEnabled={p.scrollEnabled}
//           scrollEventThrottle={16}
//           showsVerticalScrollIndicator={p.showsVSI}
//           contentContainerStyle={p.contentContainerStyle}
//           decelerationRate={p.decelerationRate}
//           onScroll={p.onScroll}
//           onScrollBeginDrag={p.onScrollBeginDrag}
//           onScrollEndDrag={p.onScrollEndDrag}
//           onMomentumScrollBegin={p.onMomentumBegin}
//           onMomentumScrollEnd={p.onMomentumEnd}
//           onViewableItemsChanged={p.onViewable}
//           onContentSizeChange={p.onContentSize}
//           onLoad={p.onLoad}
//           onEndReached={p.onEndReached}
//           onEndReachedThreshold={p.onEndReachedThreshold}
//           ListHeaderComponent={p.ListHeaderComponent}
//           ListFooterComponent={p.ListFooterComponent}
//           ListEmptyComponent={p.ListEmptyComponent}
//           ItemSeparatorComponent={p.ItemSeparatorComponent}
//         />
//       </View>
//     );
//   }).current;

//   // combinedExtraData — any data change triggers prepend FlashList to re-render
//   // its ListHeaderComponent (AppendHeader). Since AppendHeader is a stable ref,
//   // this is a re-render not a remount — scroll position preserved.
//   const combinedExtraData = useMemo(() => ({
//     extraData,
//     appendData,
//     prependData,
//   }), [extraData, appendData, prependData]);

//   // ── render ────────────────────────────────────────────────────────────────
//   return (
//     <View
//       style={[styles.container, style]}
//       onLayout={e => {
//         const h = e.nativeEvent.layout.height;
//         if (h !== containerHeight) {
//           containerHeightRef.current = h;
//           setContainerHeight(h);
//           setAppendHeight(h);
//           appendHeightRef.current = h;
//         }
//         onLayout?.(getCtx());
//       }}
//     >
//       <FlashList
//         ref={prependListRef}
//         inverted
//         data={reversedPrepend}
//         renderItem={prependRenderItem}
//         keyExtractor={keyExtractor}
//         estimatedItemSize={estimatedItemSize}
//         scrollEnabled={active === 'prepend'}
//         scrollEventThrottle={16}
//         showsVerticalScrollIndicator={showsVerticalScrollIndicator && active === 'prepend'}
//         contentContainerStyle={contentContainerStyle}
//         decelerationRate={decelerationRate}
//         extraData={combinedExtraData}
//         onScroll={onPrependScroll}
//         onScrollBeginDrag={onPrependScrollBeginDrag}
//         onScrollEndDrag={onPrependScrollEndDrag}
//         onMomentumScrollBegin={onPrependMomentumBegin}
//         onMomentumScrollEnd={onPrependMomentumEnd}
//         onViewableItemsChanged={onPrependViewable}
//         onContentSizeChange={onPrependContentSize}
//         onLoad={onPrependLoad}
//         onEndReached={onPrependEndReached}
//         onEndReachedThreshold={onStartReachedThreshold}
//         ListHeaderComponent={AppendHeader}
//         ListFooterComponent={headerForPrepend}
//         ItemSeparatorComponent={ItemSeparatorComponent}
//       />
//     </View>
//   );
// }

// // ─── forwardRef wrapper ───────────────────────────────────────────────────────

// const BiDirectionalList = forwardRef(BDListInner) as <T extends BDListItem>(
//   props: BDListProps<T> & { ref?: React.ForwardedRef<BDListHandle<T>> },
// ) => ReturnType<typeof BDListInner>;

// export default BiDirectionalList;

// // ─── Styles ───────────────────────────────────────────────────────────────────

// const styles = StyleSheet.create({
//   container: { flex: 1 },
// });
