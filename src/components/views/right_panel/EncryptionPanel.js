/*
Copyright 2019 The Matrix.org Foundation C.I.C.

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
import EncryptionInfo from "./EncryptionInfo";
import VerificationPanel from "./VerificationPanel";
import MatrixClientPeg from "../../../MatrixClientPeg";

export default class EncryptionPanel extends React.PureComponent {
    render() {
        const request = this.props.verificationRequest || this.state.verificationRequest;
        const {member} = this.props;
        if (request) {
            return <VerificationPanel request={request} />;
        } else if (member) {
            return <EncryptionInfo onStartVerification={this._onStartVerification} member={member} />;
        }
    }

    _onStartVerification = async () => {
        const client = MatrixClientPeg.get();
        const {member} = this.props;
        // TODO: get the room id of the DM here?
        // will this panel be shown in non-DM rooms?
        const verificationRequest = await client.requestVerificationDM(member.userId, member.roomId);
        this.setState({verificationRequest});
    };
}