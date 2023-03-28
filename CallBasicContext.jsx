import { createContext, useEffect, useContext, forwardRef, useImperativeHandle, useReducer } from 'react';
import PropTypes, { shape } from 'prop-types';
import format from 'string-format-obj';

import m17n from '@oceip/core/lib/m17n';
import oceip from '@oceip/core/lib/oceip';
import ApiUtil from '@oceip/core/lib/ApiUtil';
import ApiDataContextUtil from '@oceip/core/lib/ApiDataContextUtil';
import DateTimeUtility, { DateTime } from '@oceip/core/lib/DateTimeUtility';
import { EditStates } from '@oceip/ui/lib/EditableContainer';
import { GuardScreenContext } from '@oceip/ui/lib/GuardScreen';
import UiUtil from '@oceip/ui/lib/UiUtil';
import { NumericboxIntRangeValidator } from '@oceip/ui/lib/Numericbox';
import { ComplianceTypes } from '@oceip/ui/lib/services/ComplianceStore';

import { CallDetailProvider } from '@oceip/call/lib/CallDetail';
import { getDetailAsync, } from '../services/CallStore';
import MessageKeys from './languages';

import {
	moveAt,
	getDetailIndex,
	updateDetailIndex,
	getMaximumCallDate,
	getFutureCallLimit,
	removeAt,
	getDirty,
	getToDoRecordTypeId,
} from './CallBasicUtil';

export const CallBasicDispatchContext = createContext();
export const CallBasicStateContext = createContext();
export const CallBasicMainDataContext = createContext();
export const CallBasicDetailStateContext = createContext();
export const ProductMasterContext = createContext({ isOpen: false, products: null });

/**
 * 活動詳細全体的ににバリデーションエラーがあるかどうかを取得します。
 * テストコード用にエクスポートしています
 * @param {*} state
 * @return {*} エラー有り=true
 */
export function hasError(state) {
	const hasMainDataError = ApiDataContextUtil.getError(
		state.mainData,
		state.mainDataValidators,
	);
	// console.debug('callBasic hasError=', ret);
	return hasMainDataError;
}

export const callBasicContextReducer = (state, action) => {
	// console.debug(`callBasicContextReducer action?.type=[${action?.type}]`);
	switch (action?.type) {
		// データ読み込み完了
		case 'dataloaded': {
			const ret = { ...state };
			Object.keys(action.newState).forEach((key) => {
				ret[key] = action.newState[key];
			});
			ret.needInitialize = false;
			return ret;
		}
		// 再ロード要求
		case 'reload': {
			const ret = { ...state };
			ret.needInitialize = !ret.isNew;	// 既存活動は再初期化する
			return ret;
		}
		// データ無しの状態にしてなにも表示できなくします。
		case 'nodata': {
			const ret = { ...state };
			ret.mainData = null;
			ret.forceUnselect = true;
			return ret;
		}

		// 破棄しようとした
		case 'discard': {
			const ret = { ...state };
			ret.showDiscardConfirm = true;
			ret.nextAction = action.nextAction;
			return ret;
		}
		// 破棄確認でキャンセルした
		case 'discardCancel': {
			const ret = { ...state };
			ret.showDiscardConfirm = false;
			ret.nextAction = null;
			return ret;
		}
		// 破棄確認でOKした
		case 'discardOk': {
			const nextAction = state.nextAction;
			const ret = { ...state };
			ret.showDiscardConfirm = false;
			ret.nextAction = null;
			nextAction();
			return ret;
		}

		// 削除しようとした
		case 'remove': {
			const ret = { ...state };
			ret.showRemoveConfirm = true;
			return ret;
		}
		// 削除確認でキャンセルした
		case 'removeCancel': {
			const ret = { ...state };
			ret.showRemoveConfirm = false;
			return ret;
		}
		// 削除確認でOKした
		case 'removeOk': {
			const ret = { ...state };
			ret.showRemoveConfirm = false;
			return ret;
		}

		// ユーザーが編集をした
		case 'dataChanged': {
			const ret = { ...state };
			Object.keys(action.newState).forEach((key) => {
				ret[key] = action.newState[key];
			});
			return ret;
		}

		case 'detailRemove': {
			const ret = { ...state };
			const detailId = action.detailId;
			const index = getDetailIndex(ret.details, detailId);
			ret.details = removeAt(ret.details, index);
			updateDetailIndex(ret.details);

			// メッセージ, ディスカッションも削除
			ret.messages = ret.messages.filter((message) => message.OCE__CallDetail__c !== detailId);
			ret.discussions = ret.discussions.filter((discuss) => discuss.OCE__CallDetail__c !== detailId);

			return ret;
		}
		case 'detailAdd': {
			const ret = { ...state };
			ret.details = ret.details.slice();
			const detail = action.detail;
			const discussions = action.discussions;
			ret.details.push(detail);
			updateDetailIndex(ret.details);
			if (discussions.length > 0) {
				ret.discussions = ret.discussions.concat(discussions);
			}
			return ret;
		}
		// ディティールを上に
		case 'detailUp': {
			const ret = { ...state };
			const detailId = action.detailId;
			const index = getDetailIndex(ret.details, detailId);
			ret.details = moveAt(ret.details, index, index - 1);
			updateDetailIndex(ret.details);
			return ret;
		}
		// ディティールを下に
		case 'detailDown': {
			const ret = { ...state };
			const detailId = action.detailId;
			const index = getDetailIndex(ret.details, detailId);
			ret.details = moveAt(ret.details, index, index + 1);
			updateDetailIndex(ret.details);
			return ret;
		}

		default:
			throw new Error(`unknown action type. type=[${action?.type}]`);
	}
};

export class CallDateValidator {
	#maxDateTime = null;

	#futureCallLimit = null;

	constructor(maxDateTime, futureCallLimit) {
		this.#maxDateTime = maxDateTime;
		this.#futureCallLimit = futureCallLimit;
	}

	validate(value) {
		if (!value) {
			return null;
		}
		if (value.startOf('day') > this.#maxDateTime.startOf('day')) {
			return {
				type: 'CallDateValidate',
				message: format(
					m17n(MessageKeys.CALL_BASIC_ERROR_DATERANGE),
					{
						N: this.#futureCallLimit,
					},
				),
			};
		}
		return null;
	}
};

function getMainDateValidators() {
	const futureCallLimit = getFutureCallLimit();
	const maximumDate = getMaximumCallDate();
	const mainDataValidators = {
		callDateTime: [
			new CallDateValidator(maximumDate, futureCallLimit),
		],
	};

	return mainDataValidators;
}

export function getItemDateValidators() {
	return {
		OCE__Quantity__c: [
			new NumericboxIntRangeValidator(0, 999999999999999),
		],
	};
}

async function createNewCallAsync(params) {
	// 規定の経過時間の取得(数値なので文字列化しておく)
	const defaultDuration = window.oceip.OCE__LogACallSettings__c.OCE__DurationPicklist__c.toString();

	const newState = {};
	newState.status = 'Draft';
	newState.readOnly = false;
	newState.editState = EditStates.Edit;
	newState.OCE__Territory__c = params.territory;
	newState.isOwner = true;


	const callData = {
		Id: UiUtil.guid(),
		OCE__Account__c: params.accountId,
		callDateTime: params.callDateTime,
		OCE__Channel__c: ['Face To Face'],
		OCE__DurationPicklist__c: [defaultDuration],
		OCE__Territory__c: params.territory,
		OCE__Status__c: 'Draft',
		OCE__Account__r: {
			Name: params.accountName,
			type: 'Account',
		},
		OCE__ParentCall__c: null,
		OCE__Location__c: params.locationId,
		OCE__LocationName__c: params.locationName,
		OCE__Location__r: {
			OCE__AddressLine1__c: params.locationAddressLine1,
			OCE__AddressLine2__c: params.locationAddressLine2,
			OCE__AddressLine3__c: params.locationAddressLine3,
			OCE__AddressLine4__c: params.locationAddressLine4,
			OCE__City__c: params.locationCity,
			OCE__ZipCode__c: params.locationZipCode,
			OCE__State__c: params.locationState,
			OCE__Country__c: params.locationCountry,
		},
		OCE__NextCallObjective__c: '',
		// OwnerId": "0050l000006RsEHAA0",
		type: 'OCE__Call__c',
	};

	newState.mainData = callData;
	newState.originalMainData = {};
	newState.mainDataValidators = getMainDateValidators();

	newState.attendees = [];
	newState.originalAttendees = [];
	newState.attendeesComparers = {
		attendees: (original, dst) => ApiDataContextUtil.keyValueArrayComparer(original, dst, ['']),
	};

	newState.employeeAttendees = [];
	newState.originalEmployeeAttendees = [];
	newState.employeeAttendeesComparers = {
		employeeAttendees: (original, dst) => ApiDataContextUtil.keyValueArrayComparer(original, dst, ['OCE__User__c']),
	};

	newState.items = [];
	newState.itemValidators = getItemDateValidators();
	newState.originalItems = [];

	newState.details = [];
	newState.originalDetails = [];

	newState.messages = [];
	newState.originalMessages = [];
	newState.discussions = [];
	newState.originalDiscussions = [];

	newState.compliances = [];
	newState.originalCompliances = [];
	newState.complianceValidationResults = [];

	return newState;
}

/**
* 初期化処理
*/
export const initializeAsync = async ({
	id,
	isNew,
	callLayoutKey,
	params,
	callBasicDispatch,
	abortController,
}) => {
	// console.debug(`CallBasicContext initializeAsync id=${id}`);
	let newState = {};

	// 活動日に選択可能な最大値
	if (id && !isNew) {
		const callData = await getDetailAsync({
			id,
			callLayoutKey,
			signal: abortController.signal,
		});

		// versionInfo用の情報を生成しておく
		const cloneData = JSON.parse(JSON.stringify(callData));
		const midRecordTypeId = getToDoRecordTypeId(ComplianceTypes.Mid);
		const eppvRecordTypeId = getToDoRecordTypeId(ComplianceTypes.Eppv);
		const originalData = {
			OCE__Call__c: cloneData.call,
			'OCE__Call__c.group': cloneData.attendees,
			OCE__CallEmployeeAttendee__c: cloneData.employees,
			OCE__CallDetail__c: cloneData.details,
			OCE__CallMessage__c: cloneData.messages,
			OCE__CallItem__c: cloneData.items,
			OCE__CallDiscussion__c: cloneData.discussions,
			'OCE__CallToDo__c.EPPV': cloneData.compliances.filter((r) => r.RecordTypeId === eppvRecordTypeId),
			'OCE__CallToDo__c.MID': cloneData.compliances.filter((r) => r.RecordTypeId === midRecordTypeId),
		};
		newState.originalData = originalData;

		// ステータスはアクセスパスを短縮するためにコピー
		newState.OCE__Status__c = callData.call.OCE__Status__c;
		// 編集可否もアクセスパスを短縮するためにここで定義
		newState.readOnly = newState.OCE__Status__c !== 'Draft' || callData.call.OwnerId !== oceip.userInfo.userId;
		newState.editState = newState.readOnly ? EditStates.View : EditStates.Edit;
		// 同じくテリトリーも
		newState.OCE__Territory__c = callData.call.OCE__Territory__c;
		// 自身の活動かどうか
		newState.isOwner = callData.call.OwnerId === oceip.userInfo.userId;

		// #region main
		// 日付情報の型変換
		const callDateTime = DateTimeUtility.parseApiDateTime(callData.call.OCE__CallDateTime__c);
		callData.call.callDateTime = callDateTime;
		// ListSelectorと結合するので配列にする
		if (callData.call.OCE__Channel__c) {
			callData.call.OCE__Channel__c = [callData.call.OCE__Channel__c];
		} else {
			callData.call.OCE__Channel__c = [];
		}
		if (callData.call.OCE__DurationPicklist__c) {
			callData.call.OCE__DurationPicklist__c = [callData.call.OCE__DurationPicklist__c];
		} else {
			callData.call.OCE__DurationPicklist__c = [];
		}

		if (callData.call.OCE__PreCallNotes__c === null) {
			callData.call.OCE__PreCallNotes__c = '';
		}

		if (callData.call.OCE__NextCallObjective__c === null) {
			callData.call.OCE__NextCallObjective__c = '';
		}

		const mainData = { ...callData.call };
		mainData.id = callData.Id;

		newState.mainData = mainData;
		newState.originalMainData = { ...mainData };
		newState.mainDataValidators = getMainDateValidators();
		// #endregion main

		// #region 参加者
		// 参加者情報を変換
		const attendees = callData.attendees.map((attendee) => {
			const kv = {
				id: attendee.Id,	// レコードID
				OCE__Account__c: attendee.OCE__Account__c,
				name: attendee.OCE__Account__r.Name,
			};
			return kv;
		});

		// attendeesDataContext.setInitialData({ attendees, original: attendees.slice() });

		newState.attendees = attendees;
		newState.originalAttendees = attendees.slice();
		newState.attendeesComparers = {
			attendees: (original, dst) => ApiDataContextUtil.keyValueArrayComparer(original, dst, ['']),
		};
		// #endregion 参加者

		// #region 参加社員
		// 参加社員情報を変換
		const employeeAttendees = callData.employees.map((employee) => {
			const kv = {
				id: employee.Id,	// レコードID
				OCE__User__c: employee.OCE__User__c,
				name: employee.OCE__User__r.Name,
			};
			return kv;
		});

		newState.employeeAttendees = employeeAttendees;
		newState.originalEmployeeAttendees = employeeAttendees.slice();
		newState.employeeAttendeesComparers = {
			employeeAttendees: (original, dst) => ApiDataContextUtil.keyValueArrayComparer(original, dst, ['OCE__User__c']),
		};
		// #endregion 参加者

		// #region 販促資材
		const items = callData.items.map((item) => {
			const kv = {
				id: item.Id,	// レコードID
				OCE__Product__c: item.OCE__Product__c,
				OCE__Quantity__c: ApiUtil.convertApiIntegerToString(item.OCE__Quantity__c ?? 0),
				OCE__Item__c: item.OCE__Item__c,
				name: item.OCE__Item__c ? item.OCE__Item__r.Name : null,
			};
			return kv;
		});
		// #endregion 販促資材

		newState.items = items;
		newState.itemValidators = getItemDateValidators();
		newState.originalItems = JSON.parse(JSON.stringify(newState.items));

		// メッセージ
		newState.messages = callData.messages.map((v) => {
			const msg = { ...v };
			// ListSelectorとつなぐため配列化しておく
			if (msg.OCE__Reaction__c) {
				msg.OCE__Reaction__c = [msg.OCE__Reaction__c];
			} else {
				msg.OCE__Reaction__c = [];
			}
			if (msg.OCE__CustomReaction__c) {
				msg.OCE__CustomReaction__c = [msg.OCE__CustomReaction__c];
			} else {
				msg.OCE__CustomReaction__c = [];
			}
			return msg;
		});
		newState.originalMessages = JSON.parse(JSON.stringify(newState.messages));

		// ディスカッション
		newState.discussions = callData.discussions.map((v) => {
			const discuss = { ...v };
			// Textboxにnullを渡すとブランクで返ってきて変化が捉えづらいのであらかじめ''に変換しておく
			if (discuss.OCE__Notes__c === null) {
				discuss.OCE__Notes__c = '';
			}

			// ListSelectorとつなぐため配列化しておく
			if (discuss.OCE__Topic__c) {
				discuss.OCE__Topic__c = [discuss.OCE__Topic__c];
			} else {
				discuss.OCE__Topic__c = [];
			}
			return discuss;
		});
		newState.originalDiscussions = JSON.parse(JSON.stringify(newState.discussions));

		// コンプライアンス
		newState.compliances = callData.compliances.map((v) => {
			const compliance = { ...v };
			
			// ListSelectorとつなぐため配列化しておく
			if (compliance.OCE__SurveyType__c) {
				compliance.OCE__SurveyType__c = [compliance.OCE__SurveyType__c];
			} else {
				compliance.OCE__SurveyType__c = [];
			}
			return compliance;
		});
		newState.originalCompliances = JSON.parse(JSON.stringify(newState.compliances));
		newState.complianceValidationResults = [];

		// #region ディティール
		newState.details = callData.details.map((v) => {
			const ret = { ...v };
			ret.OCE__DisplayOrder__c = parseInt(ret.OCE__DisplayOrder__c, 10);
			return ret;
		});
		newState.originalDetails = callData.details;
		// #endregion ディテール

	} else if (!id && isNew) {
		// 新規の時のデータ作成
		newState = await createNewCallAsync(params);
	} else {
		throw new Error(`CallBasic:idとisNewの組み合わせがおかしいです。 id=[${id}] isNew=[${isNew}]`);
	}

	callBasicDispatch({
		type: 'dataloaded',
		newState,
	});
};

const CallBasicContextProvider = forwardRef((props, ref) => {
	const {
		id,
		isNew,
		params,
		callLayoutKey,
		children,
	} = props;

	// 画面保護/通知のdispatchを取得
	const doGuardAsync = useContext(GuardScreenContext);
	const callDetailDispath = useContext(CallDetailProvider);

	const [state, dispatch] = useReducer(
		callBasicContextReducer,
		// 活動詳細初期state
		{
			id,
			isNew,
			callLayoutKey,
			params,

			// 破棄確認用
			showDiscardConfirm: false,
			// 削除確認用
			showRemoveConfirm: false,
			// 再初期化が必要かどうか。dispatchの中からデータロード処理を呼び出す必要があるのでuseEffectのトリガーに使います。
			needInitialize: false,

			// 保存後に外側のコンポーネントに通知するパラメータ
			saveParams: null,

			// 読み取り専用かどうか
			readOnly: false,

			// call_mainのデータ。nullの時はデータ無し。
			mainData: null,
		},
	);

	// I/F用の関数定義
	useImperativeHandle(ref, () => ({
		/**
		 * 編集途中かどうか
		 * @returns 編集中:true
		 */
		isDirty: () => getDirty(state),
	}));

	useEffect(() => {
		if (state.forceUnselect) {
			// CallDetailに通知する
			callDetailDispath({
				type: 'saved',
				params: {
					cancel: true,
				},
			});
		}
	}, [state.forceUnselect, callDetailDispath]);

	useEffect(() => {
		const abortController = new AbortController();
		doGuardAsync(async () => {
			await initializeAsync({
				id,
				isNew,
				callLayoutKey,
				params,
				callBasicDispatch: dispatch,
				abortController,
			});
		});

		// アンマウントされたとき
		return () => {
			// console.debug('アンマウントされたのでAbortします');
			abortController.abort();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		let abortController;
		if (state.needInitialize) {
			abortController = new AbortController();
			// 再初期化
			doGuardAsync(async () => {
				await initializeAsync({
					id,
					isNew,
					callLayoutKey,
					params,
					callBasicDispatch: dispatch,
					abortController,
				});
			});
		}
		// アンマウントされたとき
		return () => {
			if (abortController) {
				// console.debug('アンマウントされたのでAbortします');
				abortController.abort();
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.needInitialize]);

	return (
		<CallBasicDispatchContext.Provider value={dispatch}>
			{/* 全体 */}
			<CallBasicStateContext.Provider value={state}>
				{/* ディティール */}
				<CallBasicDetailStateContext.Provider value={state.details}>
					{/* 活動詳細メイン */}
					<CallBasicMainDataContext.Provider value={state.mainData}>
						{state.mainData && children}
					</CallBasicMainDataContext.Provider>
				</CallBasicDetailStateContext.Provider>
			</CallBasicStateContext.Provider>
		</CallBasicDispatchContext.Provider>
	);
});

CallBasicContextProvider.propTypes = {
	// 既存活動を識別するID
	id: PropTypes.string,
	// 新規かどうか true=新規
	isNew: PropTypes.bool,
	/**
	 * 新規のときだけ
	 * @param {string} accountId
	 * @param {string} accountName
	 * @param {string} locationId
	 * @param {string} locationName
	 * @param {string} locationAddressLine1
	 * @param {string} locationAddressLine2
	 * @param {string} locationAddressLine3
	 * @param {string} locationAddressLine4
	 * @param {string} locationCity
	 * @param {string} locationZipCode
	 * @param {string} locationState
	 * @param {string} locationCountry
	 * @param {DateTime} callDateTime
	 * @param {string} callRecordType
	 */
	// eslint-disable-next-line react/no-unused-prop-types
	params: shape({
		territory: PropTypes.string,
		accountId: PropTypes.string,
		accountName: PropTypes.string,
		locationId: PropTypes.string,
		locationName: PropTypes.string,
		locationAddressLine1: PropTypes.string,
		locationAddressLine2: PropTypes.string,
		locationAddressLine3: PropTypes.string,
		locationAddressLine4: PropTypes.string,
		locationCity: PropTypes.string,
		locationZipCode: PropTypes.string,
		locationState: PropTypes.string,
		locationCountry: PropTypes.string,
		callDateTime: PropTypes.instanceOf(DateTime),
		callRecordType:PropTypes.string,
	}),
	// // 
	// eventType: PropTypes.string,
	callLayoutKey: PropTypes.string.isRequired,
	children: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.node), PropTypes.node]),
};

CallBasicContextProvider.defaultProps = {
	id: null,
	isNew: false,
	params: null,
	children: null,
};

export default CallBasicContextProvider;
