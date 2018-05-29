import React, {Component} from 'react';
import PropTypes from 'prop-types';
import {ScrollView, View, StyleSheet, Platform, RefreshControl, ViewPropTypes} from 'react-native';
import {shallowEqual, swapArrayElements} from './utils';
import Row from './Row';

const AUTOSCROLL_INTERVAL = 100;
const ZINDEX = Platform.OS === 'ios' ? 'zIndex' : 'elevation';

function uniqueRowKey(key) {
  return `${key}${uniqueRowKey.id}`
}

uniqueRowKey.id = 0

/**
 * SortableList
 *
 * Welcome to the `SortableList` component. Here we will attempt to
 * provide an easy to use and flexible javascript only implemenation
 * of a common UI component; the draggable, sortable list.
 *
 * ## Issues of prior implemenation
 *
 * A few notes as to why the previous version of this component
 * was not working so well.
 *
 * - Depends on `onLayout` to resolve an array of promises when
 *   ever new data or order is set. This creates a few issues when
 *   trying to reliably resolve ordering elements.
 *
 *   NOTE: Using `onLayout` is not inherently a bad idea, just creates
 *   a few challenges when waiting to resolve layout updates. It is
 *   actually the best way to support dynamic height rows.
 *
 * - Setting a new array for `data` on props would sometimes cause odd
 *   animation issues as the `rowsLayouts` state was cleared causing
 *   all rows to reset to (x: 0, y: 0) until all promises for `onLayout`
 *   were resolved.
 *
 * - We attempted to resolve an issue of rows fully unmounting and remounting
 *   by using a consistent `key` for the component. This caused an issue
 *   with not all the rows being laid out again so a set of promises would
 *   never resolve and the layout was not updating.
 *
 * ## Constraints
 *
 * In order to deal with some of the above issues we are going to sacrafice
 * a few conviniences in favor of reliability.
 *
 * - Row heights must be provided. Dynamic row height will not be supported
 *   at the moment. The `rowHeight` prop can either be a `number` or `func`.
 *
 * ## Design Choices
 *
 * UITableView and UICollectionView from UIKit on iOS will have a big influence
 * on the API of this component as I am unfamiliar with Lists on iOS.
 */
export default class SortableList extends Component {
  static propTypes = {
    /**
     * The data array that will be used to render rows.
     *
     * @note: Possibly change this to `items` to better
     * indicate this is an array.
     */
    data: PropTypes.arrayOf(PropTypes.any).isRequired,
    /**
     * The layout info. Pretty basic for now. Just provide
     * the heights for a row, header and footer. This will
     * be used to generate an internal layout object.
     *
     * {
     *   row: func | { height: number }
     *   header: func | { height: number }
     *   footer: func | { height: number }
     *   direction: oneOf (horizontal | vertical)
     * }
     */
    layout: PropTypes.object.isRequired,
    /**
     * Enable/Disable sorting.
     */
    sortingEnabled: PropTypes.bool,
    /**
     * Not sure why this prop might be needed.
     */
    scrollEnabled: PropTypes.bool,
    /**
     * Default layout direction is Vertical
     *
     * @deprecated Use `layout.direction` instead.
     */
    horizontal: PropTypes.bool,
    /**
     * ScrollViewProps to override the inner `ScrollView`.
     */
    ScrollViewVprops: PropTypes.object,
    /**
     * ScrollView Prop Overrides.
     *
     * @deprecated Use ScrollViewProps instead.
     */
    showsVerticalScrollIndicator: PropTypes.bool,
    showsHorizontalScrollIndicator: PropTypes.bool,
    /**
     * Pull to Refresh control.
     */
    refreshControl: PropTypes.element,
    /**
     * The amount of space available on each the left/right
     * or top/bottom which will begin scrolling the `scrollView`
     * once the dragging cell enters that area.
     */
    autoscrollAreaSize: PropTypes.number,
    /**
     * The delay until a row being held will enter the 
     * dragging state.
     */
    rowActivationTime: PropTypes.number,
    /**
     * Not sure what this is. Will investigage.
     */
    manuallyActivateRows: PropTypes.bool,
    /**
     * Content to be rendered into a row.
     * 
     * A `node` is exptected to be returned from this
     * function.
     *
     * Signature: (key, item, disabled, active, index)
     */
    renderRow: PropTypes.func.isRequired,
    /**
     * Content to be rendered above the first row.
     *
     * A `node` is exptected to be returned from this
     * function.
     */
    renderHeader: PropTypes.func,
    /**
     * Content to be rendered above the first row.
     *
     * A `node` is exptected to be returned from this
     * function.
     */
    renderFooter: PropTypes.func,
    /**
     * Actions
     */
    onChangeOrder: PropTypes.func,
    onActivateRow: PropTypes.func,
    onReleaseRow: PropTypes.func,
    /**
     * Style overrides.
     */ 
    style: ViewPropTypes.style,
    contentContainerStyle: ViewPropTypes.style,
    innerContainerStyle: ViewPropTypes.style,
  };

  static defaultProps = {
    sortingEnabled: true,
    scrollEnabled: true,
    autoscrollAreaSize: 60,
    manuallyActivateRows: false,
    showsVerticalScrollIndicator: true,
    showsHorizontalScrollIndicator: true
  }

  /**
   * Stores refs to rows’ components by keys.
   */
  _rows = {};

  /**
   * Stores results of `onLayout`
   */
  _rowsLayouts = {}

  /**
   * Assist with auto scrolling.
   */
  _contentOffset = {x: 0, y: 0};

  state = {
    animated: false,
    order: this.props.order || Object.keys(this.props.data),
    rowsLayout: null,
    containerLayout: null,
    data: this.props.data,
    activeRowKey: null,
    activeRowIndex: null,
    releasedRowKey: null,
    sortingEnabled: this.props.sortingEnabled,
    scrollEnabled: this.props.scrollEnabled
  };

  componentWillMount() {
    
  }

  componentDidMount() {
  }

  componentWillReceiveProps(nextProps) {
    const { 
      data, 
      order, 
    } = this.state;

    let {
      data: nextData, 
    } = nextProps;
  
    if (data && nextData && !shallowEqual(data, nextData)) {
      nextOrder = Object.keys(nextData);
      
      this.setState({
        animated: true,
        data: nextData,
        order: nextOrder
      });
    }
  }

  componentDidUpdate(prevProps, prevState) {
    const {data} = this.state;
    const {data: prevData} = prevState;

    if (data && prevData && !shallowEqual(data, prevData)) {
			this._makeLayout();
    }
  }

  /**
   * Util: Scrolls the internal scrollview by the specified
   * amount difference.
   *
   * @param {Object} See deconstructured object.
   */
  scrollBy({dx = 0, dy = 0, animated = false}) {
    if (this.props.horizontal) {
      this._contentOffset.x += dx;
    } else {
      this._contentOffset.y += dy;
    }

    this._scroll(animated);
  }

  /**
   * Util: Scrolls the internal scrollview by the specified
   * amount.
   *
   * @param {Object} See deconstructured object.
   */
  scrollTo({x = 0, y = 0, animated = false}) {
    if (this.props.horizontal) {
      this._contentOffset.x = x;
    } else {
      this._contentOffset.y = y;
    }

    this._scroll(animated);
  }

  /**
   * Not sure what this func does but maybe it is exposed
   * to be used by a ref? (Maybe I should read the docs).
   *
   * @param {Object} See deconstructured object.
   */
  scrollToRowKey({key, animated = false}) {
    const {order, containerLayout, rowsLayouts} = this.state;

    let keyX = 0;
    let keyY = 0;

    for (const rowKey of order) {
      if (rowKey === key) {
          break;
      }

      keyX += rowsLayouts[rowKey].width;
      keyY += rowsLayouts[rowKey].height;
    }

    // Scroll if the row is not visible.
    if (
      this.props.horizontal
        ? (keyX < this._contentOffset.x || keyX > this._contentOffset.x + containerLayout.width)
        : (keyY < this._contentOffset.y || keyY > this._contentOffset.y + containerLayout.height)
    ) {
      if (this.props.horizontal) {
        this._contentOffset.x = keyX;
      } else {
        this._contentOffset.y = keyY;
      }

      this._scroll(animated);
    }
  }

  render() {
    let {
      data,
      layout,
      contentContainerStyle, 
      innerContainerStyle, 
      horizontal, 
      style, 
      showsVerticalScrollIndicator, 
      showsHorizontalScrollIndicator,
      refreshControl
    } = this.props;

    const {
      animated, 
      scrollEnabled,
      contentHeight,
      contentWidth
    } = this.state;

    const containerStyle = StyleSheet.flatten([style]);

    innerContainerStyle = [
      styles.rowsContainer,
      horizontal ? {width: contentWidth} : {height: contentHeight},
      innerContainerStyle
    ];

    if (refreshControl && refreshControl.type === RefreshControl) {
      refreshControl = React.cloneElement(this.props.refreshControl, {
        enabled: scrollEnabled, // fix for Android
      });
    }

    return (
      <View style={containerStyle} ref={this._onRefContainer} onLayout={this._makeLayout}>
        <ScrollView
          refreshControl={refreshControl}
          ref={this._onRefScrollView}
          horizontal={horizontal}
          contentContainerStyle={contentContainerStyle}
          scrollEventThrottle={2}
          scrollEnabled={scrollEnabled}
          showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
          onScroll={this._onScroll}>
          {this._renderHeader()}
          <View style={innerContainerStyle}>
            {this._renderRows()}
          </View>
          {this._renderFooter()}
        </ScrollView>
      </View>
    );
  }

  /**
   * Lets render some rows. Currently seperated from the `render` function for
   * readability. Here we will render our rows based on our array of data. Each
   * row is assumed to be of the specified height from the `layout` prop.
   */
  _renderRows() {
    const {
      layout,
      horizontal, 
      rowActivationTime, 
      sortingEnabled, 
      renderRow
    } = this.props;

    const {
      animated, 
      order, 
      data,
      activeRowKey, 
      releasedRowKey
    } = this.state;

    let nextX = 0;
    let nextY = 0;

    return order.map((key, index) => {
      const style = {[ZINDEX]: 0};
      const location = {x: 0, y: 0};
      const keyForIndex = this.props.makeKeyForIndex(key) || uniqueRowKey(key);

      let rowLayout = this._rowsLayouts[key] || {};
      if (!rowLayout) {
        rowLayout.width = layout.row.width;
        rowLayout.height = layout.row.height;
      }
      
      if (horizontal) {
        location.x = nextX;
        nextX += rowLayout.width
      } else {
        location.y = nextY;
        nextY += rowLayout.height;
      }

      const active = activeRowKey === key;
      const released = releasedRowKey === key;
      
      if (active || released) {
        style[ZINDEX] = 100;
      }

      return (
        <Row
          key={keyForIndex}
          ref={this._onRefRow.bind(this, key)}
          horizontal={horizontal}
          activationTime={rowActivationTime}
          animated={animated && !active}
          disabled={!sortingEnabled}
          style={style}
          location={location}
          onLayout={this._onLayoutRow.bind(this, key)}
          onActivate={this._onActivateRow.bind(this, key, index)}
          onPress={this._onPressRow.bind(this, key)}
          onRelease={this._onReleaseRow.bind(this, key)}
          onMove={this._onMoveRow}
          manuallyActivateRows={this.props.manuallyActivateRows}>
          {renderRow({
            key,
            data: data[key],
            disabled: !sortingEnabled,
            active,
            index,
          })}
        </Row>
      );
    });
  }

  _renderHeader() {
    if (!this.props.renderHeader || this.props.horizontal) {
      return null;
    }

    console.warn('Rendering Header in SortableList is currently not finished');

    const {headerLayout} = this.state;

    return (
      <View>
        {this.props.renderHeader()}
      </View>
    );
  }

  _renderFooter() {
    if (!this.props.renderFooter || this.props.horizontal) {
      return null;
    }
    
    console.warn('Rendering Header in SortableList is currently not finished');

    const {footerLayout} = this.state;

    return (
      <View>
        {this.props.renderFooter()}
      </View>
    );
  }

  /**
   *
   */
  _layoutForRow(index) {
    
  }

  /**
   *
   */
  _makeLayout = () => {
    const {
      data,
      layout,
      horizontal
    } = this.props;

    this._container.measure((x, y, width, height, pageX, pageY) => {
      // Items
      let contentSize = data.reduce( (acc, item, index) => {
        const rowLayout = this._rowsLayouts[index];

        return {
          height: horizontal ? acc.height : (rowLayout ? rowLayout.height : layout.row.height) + acc.height,
          width: horizontal ? (rowLayout ? rowLayout.width : layout.row.width) + acc.width : acc.width
        }
      }, {
        height: 0,
        width:  0,
      });

      this.setState({
        containerLayout: {x, y, width, height, pageX, pageY},
        contentHeight: contentSize.height,
        contentWidth: contentSize.width,
      }, () => {
        this.setState({animated: true});
      });
    });
  }

  _scroll(animated) {
    this._scrollView.scrollTo({...this._contentOffset, animated});
  }

  /**
   * Finds a row under the moving row, if they are neighbours,
   * swaps them, else shifts rows.
   */
  _setOrderOnMove() {
    const {activeRowKey, activeRowIndex, order} = this.state;

    if (activeRowKey === null || this._autoScrollInterval) {
      return;
    }

    let {
      rowKey: rowUnderActiveKey,
      rowIndex: rowUnderActiveIndex,
    } = this._findRowUnderActiveRow();

    if (this._movingDirectionChanged) {
      this._prevSwapedRowKey = null;
    }

    // Swap rows if necessary.
    if (rowUnderActiveKey !== activeRowKey && rowUnderActiveKey !== this._prevSwapedRowKey) {
      const isNeighbours = Math.abs(rowUnderActiveIndex - activeRowIndex) === 1;
      let nextOrder;

      // If they are neighbours, swap elements, else shift.
      if (isNeighbours) {
        this._prevSwapedRowKey = rowUnderActiveKey;
        nextOrder = swapArrayElements(order, activeRowIndex, rowUnderActiveIndex);
      } else {
        nextOrder = order.slice();
        nextOrder.splice(activeRowIndex, 1);
        nextOrder.splice(rowUnderActiveIndex, 0, activeRowKey);
      }

      this.setState({
        order: nextOrder,
        activeRowIndex: rowUnderActiveIndex,
      });
    }
  }

  /**
   * Finds a row, which was covered with the moving row’s half.
   */
  _findRowUnderActiveRow() {
    const rowsLayouts = this._rowsLayouts;

    const {horizontal} = this.props;
    const {activeRowKey, activeRowIndex, order} = this.state;
    const movingRowLayout = rowsLayouts[activeRowKey];
    const rowLeftX = this._activeRowLocation.x
    const rowRightX = rowLeftX + movingRowLayout.width;
    const rowTopY = this._activeRowLocation.y;
    const rowBottomY = rowTopY + movingRowLayout.height;

    for (
      let currentRowIndex = 0, x = 0, y = 0, rowsCount = order.length;
      currentRowIndex < rowsCount - 1;
      currentRowIndex++
    ) {
      const currentRowKey = order[currentRowIndex];
      const currentRowLayout = rowsLayouts[currentRowKey];
      const nextRowIndex = currentRowIndex + 1;
      const nextRowLayout = rowsLayouts[order[nextRowIndex]];

      x += currentRowLayout.width;
      y += currentRowLayout.height;

      if (currentRowKey !== activeRowKey && (
        horizontal
          ? ((x - currentRowLayout.width <= rowLeftX || currentRowIndex === 0) && rowLeftX <= x - currentRowLayout.width / 3)
          : ((y - currentRowLayout.height <= rowTopY || currentRowIndex === 0) && rowTopY <= y - currentRowLayout.height / 3)
      )) {
        return {
          rowKey: order[currentRowIndex],
          rowIndex: currentRowIndex,
        };
      }

      if (horizontal
        ? (x + nextRowLayout.width / 3 <= rowRightX && (rowRightX <= x + nextRowLayout.width || nextRowIndex === rowsCount - 1))
        : (y + nextRowLayout.height / 3 <= rowBottomY && (rowBottomY <= y + nextRowLayout.height || nextRowIndex === rowsCount - 1))
      ) {
        return {
          rowKey: order[nextRowIndex],
          rowIndex: nextRowIndex,
        };
      }
    }

    return {rowKey: activeRowKey, rowIndex: activeRowIndex};
  }

  _scrollOnMove(e) {
    const {pageX, pageY} = e.nativeEvent;
    const {horizontal} = this.props;
    const {containerLayout} = this.state;
    let inAutoScrollBeginArea = false;
    let inAutoScrollEndArea = false;

    if (horizontal) {
      inAutoScrollBeginArea = pageX < containerLayout.pageX + this.props.autoscrollAreaSize;
      inAutoScrollEndArea = pageX > containerLayout.pageX + containerLayout.width - this.props.autoscrollAreaSize;
    } else {
      inAutoScrollBeginArea = pageY < containerLayout.pageY + this.props.autoscrollAreaSize;
      inAutoScrollEndArea = pageY > containerLayout.pageY + containerLayout.height - this.props.autoscrollAreaSize;
    }

    if (!inAutoScrollBeginArea &&
      !inAutoScrollEndArea &&
      this._autoScrollInterval !== null
    ) {
      this._stopAutoScroll();
    }

    // It should scroll and scrolling is processing.
    if (this._autoScrollInterval !== null) {
      return;
    }

    if (inAutoScrollBeginArea) {
      this._startAutoScroll({
        direction: -1,
        shouldScroll: () => this._contentOffset[horizontal ? 'x' : 'y'] > 0,
        getScrollStep: (stepIndex) => {
          const nextStep = this._getScrollStep(stepIndex);
          const contentOffset = this._contentOffset[horizontal ? 'x' : 'y'];

          return contentOffset - nextStep < 0 ? contentOffset : nextStep;
        },
      });
    } else if (inAutoScrollEndArea) {
      this._startAutoScroll({
        direction: 1,
        shouldScroll: () => {
          const {
            contentHeight,
            contentWidth,
            containerLayout,
            footerLayout = {height: 0},
          } = this.state;

          if (horizontal) {
            return this._contentOffset.x < contentWidth - containerLayout.width
          } else {
            return this._contentOffset.y < contentHeight + footerLayout.height - containerLayout.height;
          }
        },
        getScrollStep: (stepIndex) => {
          const nextStep = this._getScrollStep(stepIndex);
          const {
            contentHeight,
            contentWidth,
            containerLayout,
            footerLayout = {height: 0},
          } = this.state;

          if (horizontal) {
            return this._contentOffset.x + nextStep > contentWidth - containerLayout.width
              ? contentWidth - containerLayout.width - this._contentOffset.x
              : nextStep;
          } else {
            const scrollHeight = contentHeight + footerLayout.height - containerLayout.height;

            return this._contentOffset.y + nextStep > scrollHeight
              ? scrollHeight - this._contentOffset.y
              : nextStep;
          }
        },
      });
    }
  }

  _getScrollStep(stepIndex) {
    return stepIndex > 3 ? 60 : 30;
  }

  _startAutoScroll({direction, shouldScroll, getScrollStep}) {
    if (!shouldScroll()) {
      return;
    }

    const {activeRowKey} = this.state;
    const {horizontal} = this.props;
    let counter = 0;

    this._autoScrollInterval = setInterval(() => {
      if (shouldScroll()) {
        const movement = {
          [horizontal ? 'dx' : 'dy']: direction * getScrollStep(counter++),
        };

        this.scrollBy(movement);
        this._rows[activeRowKey].moveBy(movement);
      } else {
        this._stopAutoScroll();
      }
    }, AUTOSCROLL_INTERVAL);
  }

  _stopAutoScroll() {
    clearInterval(this._autoScrollInterval);
    this._autoScrollInterval = null;
  }

  _onLayoutRow(rowKey, {nativeEvent: {layout}}) {
    this._rowsLayouts[rowKey] = layout;
  }

  _onLayoutHeader = ({nativeEvent: {layout}}) => {
    this._resolveHeaderLayout(layout);
  };

  _onLayoutFooter = ({nativeEvent: {layout}}) => {
    this._resolveFooterLayout(layout);
  };

  _onActivateRow = (rowKey, index, e, gestureState, location) => {
    this._activeRowLocation = location;

    this.setState({
      activeRowKey: rowKey,
      activeRowIndex: index,
      releasedRowKey: null,
      scrollEnabled: false,
    });

    if (this.props.onActivateRow) {
      this.props.onActivateRow(rowKey);
    }
  };

  _onPressRow = (rowKey) => {
    if (this.props.onPressRow) {
      this.props.onPressRow(rowKey);
    }
  };

  _onReleaseRow = (rowKey) => {
    this._stopAutoScroll();
    this.setState(({activeRowKey}) => ({
      activeRowKey: null,
      activeRowIndex: null,
      releasedRowKey: activeRowKey,
      scrollEnabled: this.props.scrollEnabled,
    }), () => {
      if (this.props.onChangeOrder) {
        setTimeout( () => {
          this.props.onChangeOrder(this.state.order);
        }, 500);
      }
    });

    if (this.props.onReleaseRow) {
      this.props.onReleaseRow(rowKey);
    }
  };

  _onMoveRow = (e, gestureState, location) => {
    const prevMovingRowX = this._activeRowLocation.x;
    const prevMovingRowY = this._activeRowLocation.y;
    const prevMovingDirection = this._movingDirection;

    this._activeRowLocation = location;
    this._movingDirection = this.props.horizontal
      ? prevMovingRowX < this._activeRowLocation.x
      : prevMovingRowY < this._activeRowLocation.y;

    this._movingDirectionChanged = prevMovingDirection !== this._movingDirection;
    this._setOrderOnMove();

    if (this.props.scrollEnabled) {
      this._scrollOnMove(e);
    }
  };

  _onScroll = ({nativeEvent: {contentOffset}}) => {
      this._contentOffset = contentOffset;
  };

  _onRefContainer = (component) => {
    this._container = component;
  };

  _onRefScrollView = (component) => {
    this._scrollView = component;
  };

  _onRefRow = (rowKey, component) => {
    this._rows[rowKey] = component;
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  rowsContainer: {
    flex: 1,
    zIndex: 1,
  },
});
