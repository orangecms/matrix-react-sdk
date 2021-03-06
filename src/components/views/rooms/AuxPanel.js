/*
Copyright 2015, 2016 OpenMarket Ltd
Copyright 2017 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React from 'react';
import PropTypes from 'prop-types';
import {MatrixClientPeg} from "../../../MatrixClientPeg";
import * as sdk from '../../../index';
import dis from "../../../dispatcher/dispatcher";
import * as ObjectUtils from '../../../ObjectUtils';
import AppsDrawer from './AppsDrawer';
import { _t } from '../../../languageHandler';
import classNames from 'classnames';
import RateLimitedFunc from '../../../ratelimitedfunc';
import SettingsStore from "../../../settings/SettingsStore";
import AutoHideScrollbar from "../../structures/AutoHideScrollbar";
import CallView from "../voip/CallView";
import {UIFeature} from "../../../settings/UIFeature";


export default class AuxPanel extends React.Component {
    static propTypes = {
        // js-sdk room object
        room: PropTypes.object.isRequired,
        userId: PropTypes.string.isRequired,
        showApps: PropTypes.bool, // Render apps
        hideAppsDrawer: PropTypes.bool, // Do not display apps drawer and content (may still be rendered)

        // set to true to show the file drop target
        draggingFile: PropTypes.bool,

        // maxHeight attribute for the aux panel and the video
        // therein
        maxHeight: PropTypes.number,

        // a callback which is called when the content of the aux panel changes
        // content in a way that is likely to make it change size.
        onResize: PropTypes.func,
        fullHeight: PropTypes.bool,
    };

    static defaultProps = {
        showApps: true,
        hideAppsDrawer: false,
    };

    constructor(props) {
        super(props);

        this.state = {
            counters: this._computeCounters(),
        };
    }

    componentDidMount() {
        const cli = MatrixClientPeg.get();
        cli.on("RoomState.events", this._rateLimitedUpdate);
    }

    componentWillUnmount() {
        const cli = MatrixClientPeg.get();
        if (cli) {
            cli.removeListener("RoomState.events", this._rateLimitedUpdate);
        }
    }

    shouldComponentUpdate(nextProps, nextState) {
        return (!ObjectUtils.shallowEqual(this.props, nextProps) ||
                !ObjectUtils.shallowEqual(this.state, nextState));
    }

    componentDidUpdate(prevProps, prevState) {
        // most changes are likely to cause a resize
        if (this.props.onResize) {
            this.props.onResize();
        }
    }

    onConferenceNotificationClick = (ev, type) => {
        dis.dispatch({
            action: 'place_call',
            type: type,
            room_id: this.props.room.roomId,
        });
        ev.stopPropagation();
        ev.preventDefault();
    };

    _rateLimitedUpdate = new RateLimitedFunc(() => {
        if (SettingsStore.getValue("feature_state_counters")) {
            this.setState({counters: this._computeCounters()});
        }
    }, 500);

    _computeCounters() {
        let counters = [];

        if (this.props.room && SettingsStore.getValue("feature_state_counters")) {
            const stateEvs = this.props.room.currentState.getStateEvents('re.jki.counter');
            stateEvs.sort((a, b) => {
                return a.getStateKey() < b.getStateKey();
            });

            stateEvs.forEach((ev, idx) => {
                const title = ev.getContent().title;
                const value = ev.getContent().value;
                const link = ev.getContent().link;
                const severity = ev.getContent().severity || "normal";
                const stateKey = ev.getStateKey();

                // We want a non-empty title but can accept falsey values (e.g.
                // zero)
                if (title && value !== undefined) {
                    counters.push({
                        "title": title,
                        "value": value,
                        "link": link,
                        "severity": severity,
                        "stateKey": stateKey
                    })
                }
            });
        }

        return counters;
    }

    render() {
        const TintableSvg = sdk.getComponent("elements.TintableSvg");

        let fileDropTarget = null;
        if (this.props.draggingFile) {
            fileDropTarget = (
                <div className="mx_RoomView_fileDropTarget">
                    <div className="mx_RoomView_fileDropTargetLabel"
                      title={_t("Drop File Here")}>
                        <TintableSvg src={require("../../../../res/img/upload-big.svg")} width="45" height="59" />
                        <br />
                        { _t("Drop file here to upload") }
                    </div>
                </div>
            );
        }

        const callView = (
            <CallView
                room={this.props.room}
                onResize={this.props.onResize}
                maxVideoHeight={this.props.maxHeight}
            />
        );

        let appsDrawer;
        if (SettingsStore.getValue(UIFeature.Widgets)) {
            appsDrawer = <AppsDrawer
                room={this.props.room}
                userId={this.props.userId}
                maxHeight={this.props.maxHeight}
                showApps={this.props.showApps}
                hide={this.props.hideAppsDrawer}
                resizeNotifier={this.props.resizeNotifier}
            />;
        }

        let stateViews = null;
        if (this.state.counters && SettingsStore.getValue("feature_state_counters")) {
            const counters = [];

            this.state.counters.forEach((counter, idx) => {
                const title = counter.title;
                const value = counter.value;
                const link = counter.link;
                const severity = counter.severity;
                const stateKey = counter.stateKey;

                let span = <span>{ title }: { value }</span>;

                if (link) {
                    span = (
                        <a href={link} target="_blank" rel="noreferrer noopener">
                            { span }
                        </a>
                    );
                }

                span = (
                    <span
                        className="m_RoomView_auxPanel_stateViews_span"
                        data-severity={severity}
                        key={ "x-" + stateKey }
                    >
                        {span}
                    </span>
                );

                counters.push(span);
                counters.push(
                    <span
                        className="m_RoomView_auxPanel_stateViews_delim"
                        key={"delim" + idx}
                    > ─ </span>
                );
            });

            if (counters.length > 0) {
                counters.pop(); // remove last deliminator
                stateViews = (
                    <div className="m_RoomView_auxPanel_stateViews">
                        { counters }
                    </div>
                );
            }
        }

        const classes = classNames({
            "mx_RoomView_auxPanel": true,
            "mx_RoomView_auxPanel_fullHeight": this.props.fullHeight,
        });
        const style = {};
        if (!this.props.fullHeight) {
            style.maxHeight = this.props.maxHeight;
        }

        return (
            <AutoHideScrollbar className={classes} style={style} >
                { stateViews }
                { appsDrawer }
                { fileDropTarget }
                { callView }
                { this.props.children }
            </AutoHideScrollbar>
        );
    }
}
