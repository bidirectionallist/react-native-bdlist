# react-native-bdlist

A bidirectional infinite scroll list for React Native with **native virtualization**, **zero flicker on prepend/append**, and **seamless focus-transition** between history and new content.

Built on top of [@shopify/flash-list](https://github.com/Shopify/flash-list) for native-speed rendering.

---

## The Problem

Every existing solution for bidirectional lists in React Native suffers from the same issue: prepending items causes a layout recalculation before scroll correction fires, creating a one-frame gap that shows as a flicker or jump. Libraries like FlashList and FlatList don't support prepend without this issue.

## The Solution

`BDList` uses two FlashLists with a **focus-transition architecture**:

- **Append list** (normal) — newer items, lives as a header inside the prepend list
- **Prepend list** (inverted) — older/history items

Only ONE list is `scrollEnabled` at a time. When the active list reaches its boundary (`offset === 0`), focus transfers instantly to the other list. No JS animation, no scroll correction, no flicker.

```
prepend list (inverted) ← holds history
  └─ ListHeaderComponent: append list ← holds new content
```

---

## Installation

```bash
npm install react-native-bdlist @shopify/flash-list
# or
yarn add react-native-bdlist @shopify/flash-list
```

> **Requirements:** `@shopify/flash-list >= 1.0.0`, `react-native >= 0.70.0`

---

## Quick Start

```tsx
import BiDirectionalList, { BDListHandle, BDData } from 'react-native-bdlist';

const listRef = useRef<BDListHandle<Message>>(null);

<BiDirectionalList
  ref={listRef}
  initialData={messages}
  estimatedItemSize={80}
  keyExtractor={(item) => item.id}
  renderItem={({ item, isAppend }) => (
    <MessageBubble message={item} />
  )}
  onStartReached={() => {
    // user scrolled to top — load older messages
    fetchOlderMessages().then(older => {
      listRef.current?.prepend(older);
    });
  }}
  onEndReached={() => {
    // user scrolled to bottom — load newer messages
    fetchNewerMessages().then(newer => {
      listRef.current?.append(newer);
    });
  }}
/>
```

---

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `initialData` | `T[]` | required | Initial items — goes into the append (new content) list |
| `renderItem` | `(info: MyRenderItemInfo<T>) => ReactElement` | required | Render function. Receives `isAppend` and `batchIndex` in addition to standard FlashList props |
| `keyExtractor` | `(item, index) => string` | — | Key extractor |
| `estimatedItemSize` | `number` | `80` | FlashList estimated item size |
| `extraData` | `any` | — | Pass any value that should trigger re-renders (like `associatePortalstats`) |
| `uniqueBy` | `string` | — | Field name for deduplication (e.g. `"id"`) |
| `onStartReached` | `() => void` | — | Fires when scrolled near the top (history boundary) |
| `onEndReached` | `() => void` | — | Fires when scrolled near the bottom (new content boundary) |
| `onStartReachedThreshold` | `number` | `0.3` | Fraction of container height from top to trigger `onStartReached` |
| `onEndReachedThreshold` | `number` | `0.3` | Fraction of container height from bottom to trigger `onEndReached` |
| `onStartLeave` | `() => void` | — | Fires when user scrolls away from the top threshold |
| `onEndLeave` | `() => void` | — | Fires when user scrolls away from the bottom threshold |
| `onStartLeaveThreshold` | `number` | same as `onStartReachedThreshold` | Custom leave threshold for top |
| `onEndLeaveThreshold` | `number` | same as `onEndReachedThreshold` | Custom leave threshold for bottom |
| `onScroll` | `(e, ctx) => void` | — | Scroll event. `ctx` contains `active`, `hasAppendData`, `hasPrependData` |
| `onActiveChange` | `(active) => void` | — | Fires when focus transitions between append and prepend |
| `onScrollBeginDrag` | `(ctx) => void` | — | |
| `onScrollEndDrag` | `(ctx) => void` | — | |
| `onMomentumScrollBegin` | `(ctx) => void` | — | |
| `onMomentumScrollEnd` | `(ctx) => void` | — | |
| `onViewableItemsChanged` | `(info, ctx) => void` | — | |
| `onContentSizeChange` | `(w, h, ctx) => void` | — | |
| `onLoad` | `(ctx) => void` | — | |
| `onLayout` | `(ctx) => void` | — | |
| `ListHeaderComponent` | `ReactNode` | — | Rendered at the visual top of the list |
| `ListFooterComponent` | `ReactNode` | — | Rendered at the visual bottom of the list |
| `ListEmptyComponent` | `ReactNode` | — | Rendered when both lists are empty |
| `ItemSeparatorComponent` | `() => ReactNode` | — | |
| `style` | `ViewStyle` | — | Container style |
| `contentContainerStyle` | `ViewStyle` | — | Content container style |
| `showsVerticalScrollIndicator` | `boolean` | `true` | |
| `decelerationRate` | `'normal' \| 'fast' \| number` | `'normal'` | |

---

## Imperative Handle

```tsx
const listRef = useRef<BDListHandle<MyItem>>(null);
```

### Scroll

| Method | Description |
|--------|-------------|
| `scrollToEnd({ animated? })` | Scroll to newest content (bottom of append). If in prepend, transitions automatically |
| `scrollToStart({ animated? })` | Scroll to oldest content (end of prepend). If in append, transitions automatically |
| `scrollToOffset({ offset, animated? })` | Unified offset across both lists |
| `scrollToIndex({ index, animated?, viewOffset? })` | Scroll to item by unified index (auto-detects which list) |
| `scrollAppendToEnd(animated?)` | Explicit — scroll append list to end |
| `scrollPrependToEnd(animated?)` | Explicit — scroll prepend list to end |
| `scrollAppendToOffset(offset, animated?)` | Explicit |
| `scrollPrependToOffset(offset, animated?)` | Explicit |

### Data

| Method | Description |
|--------|-------------|
| `prepend(items)` | Add items to the top (history). If both lists empty, goes to append |
| `append(items)` | Add items to the bottom (new content) |
| `getAllData()` | Returns `BDData<T>[]` — unified array with `type`, `item`, `localIndex` |
| `getData()` | Returns `[{type:'prepend', data}, {type:'append', data}]` |
| `setData(items)` | Full reset — all items go to append list |
| `updateData(segments)` | Override one or both lists (for delete/modify operations) |
| `setStateData(callback)` | Functional update — receive current `BDData[]`, return modified version |

### State

| Method | Description |
|--------|-------------|
| `getActive()` | Returns `'append' \| 'prepend'` |
| `setActive(active)` | Programmatically flip focus |
| `getContext()` | Returns `BDScrollContext` — `{ active, hasAppendData, hasPrependData }` |

---

## renderItem

`renderItem` receives a standard FlashList `ListRenderItemInfo<T>` plus:

```ts
type MyRenderItemInfo<T> = ListRenderItemInfo<T> & {
  isAppend:   boolean;  // true if item is in the append (new content) list
  batchIndex: number;   // local index within its list
};
```

`index` is the unified index across both lists (prepend items first, then append).

---

## BDScrollContext

All callbacks receive a `BDScrollContext`:

```ts
interface BDScrollContext {
  active:         'append' | 'prepend'; // which list is currently scrollable
  hasAppendData:  boolean;
  hasPrependData: boolean;
}
```

---

## Performance Tips

1. **Memoize `renderItem`** with `useCallback` so it only updates when its deps change:
   ```tsx
   const renderItem = useCallback(({ item, isAppend }) => (
     <MyItem item={item} status={status} />
   ), [status]);
   ```

2. **Memoize your item component** with `React.memo` and a custom comparator to skip unnecessary re-renders:
   ```tsx
   const MyItem = React.memo(({ item, isDelivered }) => { ... }, (prev, next) => {
     if (prev.item.id !== next.item.id) return false;
     if (prev.isDelivered !== next.isDelivered) return false;
     return true;
   });
   ```

3. **Compute derived booleans before passing** — instead of passing `associatePortalstats` and computing inside the item, compute in `renderItem` and pass the boolean:
   ```tsx
   renderItem={useCallback(({ item }) => (
     <MyItem
       item={item}
       isDelivered={isDateGreater(stats?.lastDelivered, item.createdAt)}
       isSeen={isDateGreater(stats?.lastSeen, item.createdAt)}
     />
   ), [stats])}
   ```

4. **Use `extraData`** for any external value that affects rendering:
   ```tsx
   <BiDirectionalList extraData={associatePortalstats} ... />
   ```

---

## How the Focus Transition Works

```
State: active = 'append'
  → append FlashList: scrollEnabled = true
  → prepend FlashList: scrollEnabled = false (locked at offset 0)

User scrolls append to offset 0 (top of append = boundary with prepend):
  → setActive('prepend') immediately on onScroll
  → prepend FlashList: scrollEnabled = true
  → append FlashList: scrollEnabled = false
  → 100px momentum kick on prepend for natural feel

State: active = 'prepend'
  → prepend FlashList: scrollEnabled = true
  → append FlashList: scrollEnabled = false

User scrolls prepend to offset 0 (bottom of inverted prepend = boundary with append):
  → setActive('append')
  → focus returns to append
```

The transition happens on `onScroll` (not `onMomentumScrollEnd`), so focus flips the instant the boundary is reached — before the user lifts their finger.

---

## License

MIT
