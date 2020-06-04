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

import EventIndexPeg from "./indexing/EventIndexPeg";
import {MatrixClientPeg} from "./MatrixClientPeg";

async function serverSideSearch(term, roomId = undefined, processResult = true) {
    const client = MatrixClientPeg.get();

    let filter;
    if (roomId !== undefined) {
        // XXX: it's unintuitive that the filter for searching doesn't have
        // the same shape as the v2 filter API :(
        filter = {
            rooms: [roomId],
        };
    }

    const body = {
        search_categories: {
            room_events: {
                search_term: term,
                filter: filter,
                order_by: "recent",
                event_context: {
                    before_limit: 1,
                    after_limit: 1,
                    include_profile: true,
                },
            },
        },
    };

    const response = await client.search({body: body});

    if (processResult) {
        const searchResult = {
            _query: body,
            results: [],
            highlights: [],
        };

        return client._processRoomEventsSearch(searchResult, response);
    }

    const result = {
        response: response,
        query: body,
    };

    return result;
}

function compareEvents(a, b) {
    const aEvent = a.result;
    const bEvent = b.result;

    if (aEvent.origin_server_ts >
        bEvent.origin_server_ts) return -1;
    if (aEvent.origin_server_ts <
        bEvent.origin_server_ts) return 1;
    return 0;
}

async function combinedSearch(searchTerm) {
    const client = MatrixClientPeg.get();

    // Create two promises, one for the local search, one for the
    // server-side search.
    const serverSidePromise = serverSideSearch(searchTerm, undefined, false);
    const localPromise = localSearch(searchTerm, undefined, false);

    // Wait for both promises to resolve.
    await Promise.all([serverSidePromise, localPromise]);

    // Get both search results.
    const localResult = await localPromise;
    const serverSideResult = await serverSidePromise;

    const serverQuery = serverSideResult.query;
    const serverResponse = serverSideResult.response;

    const localQuery = localResult.query;
    const localResponse = localResult.response;

    const emptyResult = {
        seshatQuery: localQuery,
        _query: serverQuery,
        serverSideNextBatch: serverResponse.next_batch,
        results: [],
        highlights: [],
    };

    const combinedResult = combineResponses(emptyResult, localResponse, serverResponse.search_categories.room_events);

    const response = {
        search_categories: {
            room_events: combinedResult,
        },
    };

    const result = client._processRoomEventsSearch(emptyResult, response);

    return result;
}

async function localSearch(searchTerm, roomId = undefined, processResult = true) {
    const searchArgs = {
        search_term: searchTerm,
        before_limit: 1,
        after_limit: 1,
        order_by_recency: true,
        room_id: undefined,
    };

    if (roomId !== undefined) {
        searchArgs.room_id = roomId;
    }

    const emptyResult = {
        seshatQuery: searchArgs,
        results: [],
        highlights: [],
    };

    if (searchTerm === "") return emptyResult;

    const eventIndex = EventIndexPeg.get();

    const localResult = await eventIndex.search(searchArgs);

    if (processResult) {
        emptyResult.seshatQuery.next_batch = localResult.next_batch;

        const response = {
            search_categories: {
                room_events: localResult,
            },
        };

        return MatrixClientPeg.get()._processRoomEventsSearch(emptyResult, response);
    }

    searchArgs.next_batch = localResult.next_batch;

    const result = {
        response: localResult,
        query: searchArgs,
    }

    return result;
}

async function localPagination(searchResult) {
    const eventIndex = EventIndexPeg.get();

    const searchArgs = searchResult.seshatQuery;

    const localResult = await eventIndex.search(searchArgs);
    searchResult.seshatQuery.next_batch = localResult.next_batch;

    const response = {
        search_categories: {
            room_events: localResult,
        },
    };

    const result = MatrixClientPeg.get()._processRoomEventsSearch(searchResult, response);
    searchResult.pendingRequest = null;

    return result;
}

function combineEvents(previousSearchResult, localEvents = undefined, serverEvents = undefined) {
    const response = {};

    let oldestEventFrom = "server";
    let cachedEvents;

    if (previousSearchResult.oldestEventFrom) {
        oldestEventFrom = previousSearchResult.oldestEventFrom;
    }

    if (previousSearchResult.cachedEvents) {
        cachedEvents = previousSearchResult.cachedEvents;
    }

    if (localEvents && serverEvents) {
        const oldestLocalEvent = localEvents.results[localEvents.results.length - 1].result;
        const oldestServerEvent = serverEvents.results[serverEvents.results.length - 1].result;

        if (oldestLocalEvent.origin_server_ts <= oldestServerEvent.origin_server_ts) {
            oldestEventFrom = "local";
        }

        const combinedEvents = localEvents.results.concat(serverEvents.results).sort(compareEvents);
        response.results = combinedEvents.slice(0, 10);
        response.highlights = localEvents.highlights.concat(serverEvents.highlights);
        previousSearchResult.cachedEvents = combinedEvents.slice(10);
        console.log("HELLOO COMBINED", combinedEvents);
    } else if (localEvents) {
        if (cachedEvents && cachedEvents.length > 0) {
            const oldestLocalEvent = localEvents.results[localEvents.results.length - 1].result;
            const oldestCachedEvent = cachedEvents[cachedEvents.length - 1].result;

            if (oldestLocalEvent.origin_server_ts <= oldestCachedEvent.origin_server_ts) {
                oldestEventFrom = "local";
            }

            const combinedEvents = localEvents.results.concat(cachedEvents).sort(compareEvents);
            response.results = combinedEvents.slice(0, 10);
            previousSearchResult.cachedEvents = combinedEvents.slice(10);
        } else {
            response.results = localEvents.results;
        }

        response.highlights = localEvents.highlights;
    } else if (serverEvents) {
        console.log("HEEEEELOO WHAT'S GOING ON", cachedEvents);
        if (cachedEvents && cachedEvents.length > 0) {
            const oldestServerEvent = serverEvents.results[serverEvents.results.length - 1].result;
            const oldestCachedEvent = cachedEvents[cachedEvents.length - 1].result;

            if (oldestServerEvent.origin_server_ts <= oldestCachedEvent.origin_server_ts) {
                oldestEventFrom = "server";
            }

            const combinedEvents = serverEvents.results.concat(cachedEvents).sort(compareEvents);
            response.results = combinedEvents.slice(0, 10);
            previousSearchResult.cachedEvents = combinedEvents.slice(10);
        } else {
            response.results = serverEvents.results;
        }
        response.highlights = serverEvents.highlights;
    } else {
        if (cachedEvents && cachedEvents.length > 0) {
            response.results = cachedEvents;
        }
        response.highlights = [];

        delete previousSearchResult.cachedEvents;
    }

    previousSearchResult.oldestEventFrom = oldestEventFrom;

    return response;
}

/**
 * Combine the local and server search responses
 */
function combineResponses(previousSearchResult, localEvents = undefined, serverEvents = undefined) {
    const response = combineEvents(previousSearchResult, localEvents, serverEvents);

    if (previousSearchResult.count) {
        response.count = previousSearchResult.count;
    } else {
        response.count = localEvents.count + serverEvents.count;
    }

    if (localEvents) {
        previousSearchResult.seshatQuery.next_batch = localEvents.next_batch;
    }

    if (serverEvents) {
        previousSearchResult.serverSideNextBatch = serverEvents.next_batch;
    }

    if (previousSearchResult.seshatQuery.next_batch) {
        response.next_batch = previousSearchResult.seshatQuery.next_batch;
    } else if (previousSearchResult.serverSideNextBatch) {
        response.next_batch = previousSearchResult.serverSideNextBatch;
    }

    if (!response.next_batch && previousSearchResult.cachedEvents && previousSearchResult.cachedEvents.length > 0) {
        response.next_batch = "cached";
    }

    console.log("HELLOO COMBINING RESULTS", localEvents, serverEvents, response);

    return response
}

async function combinedPagination(searchResult) {
    const eventIndex = EventIndexPeg.get();
    const client = MatrixClientPeg.get();

    console.log("HELLOOO WORLD", searchResult.oldestEventFrom);

    const searchArgs = searchResult.seshatQuery;

    let localResult;
    let serverSideResult;

    const oldestEventFrom = searchResult.oldestEventFrom;

    if ((searchArgs.next_batch && oldestEventFrom === "server") || (!searchResult.serverSideNextBatch && searchArgs.next_batch)) {
        localResult = await eventIndex.search(searchArgs);
    }

    if ((searchResult.serverSideNextBatch && oldestEventFrom === "local") || (!searchArgs.next_batch && searchResult.serverSideNextBatch)) {
        const body = {body: searchResult._query, next_batch: searchResult.serverSideNextBatch};
        serverSideResult = await client.search(body);
    }

    let serverEvents;

    if (serverSideResult) {
        serverEvents = serverSideResult.search_categories.room_events;
    }

    const combinedResult = combineResponses(searchResult, localResult, serverEvents);

    const response = {
        search_categories: {
            room_events: combinedResult,
        },
    };

    const result = client._processRoomEventsSearch(searchResult, response);

    console.log("HELLO NEW RESULT", searchResult);

    searchResult.pendingRequest = null;

    return result
}

function eventIndexSearch(term, roomId = undefined) {
    let searchPromise;

    if (roomId !== undefined) {
        if (MatrixClientPeg.get().isRoomEncrypted(roomId)) {
            // The search is for a single encrypted room, use our local
            // search method.
            searchPromise = localSearch(term, roomId);
        } else {
            // The search is for a single non-encrypted room, use the
            // server-side search.
            searchPromise = serverSideSearch(term, roomId);
        }
    } else {
        // Search across all rooms, combine a server side search and a
        // local search.
        searchPromise = combinedSearch(term);
    }

    return searchPromise;
}

function eventIndexSearchPagination(searchResult) {
    const client = MatrixClientPeg.get();

    const seshatQuery = searchResult.seshatQuery;
    const serverQuery = searchResult._query;

    if (!seshatQuery) {
        return client.backPaginateRoomEventsSearch(searchResult);
    } else if (!serverQuery) {
        const promise = localPagination(searchResult);
        searchResult.pendingRequest = promise;

        return promise;
    } else {
        const promise = combinedPagination(searchResult);
        searchResult.pendingRequest = promise;

        return promise
    }
}

export function searchPagination(searchResult) {
    const eventIndex = EventIndexPeg.get();
    const client = MatrixClientPeg.get();

    if (searchResult.pendingRequest) return searchResult.pendingRequest;

    if (eventIndex === null) return client.backPaginateRoomEventsSearch(searchResult);
    else return eventIndexSearchPagination(searchResult);
}

export default function eventSearch(term, roomId = undefined) {
    const eventIndex = EventIndexPeg.get();

    if (eventIndex === null) return serverSideSearch(term, roomId);
    else return eventIndexSearch(term, roomId);
}
