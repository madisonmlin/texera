/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

\c texera_db
SET search_path TO texera_db, public;

BEGIN;

CREATE TABLE IF NOT EXISTS template
(
    tid 		            SERIAL PRIMARY KEY,
    name 		            VARCHAR(128) NOT NULL,
    description             VARCHAR(500),
    content 	            TEXT NOT NULL,
    creation_time           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_modified_time      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    configurable_parameters TEXT
    );

CREATE TABLE IF NOT EXISTS workflow_of_template
(
    tid         INT NOT NULL,
    wid         INT PRIMARY KEY,
    parameters  TEXT,
    FOREIGN KEY (tid) REFERENCES template(tid) ON DELETE CASCADE,
    FOREIGN KEY (wid) REFERENCES workflow(wid) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS template_of_user
(
    uid INT NOT NULL,
    tid INT NOT NULL,
    PRIMARY KEY (uid, tid),
    FOREIGN KEY (uid) REFERENCES "user"(uid) ON DELETE CASCADE,
    FOREIGN KEY (tid) REFERENCES template(tid) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS template_user_access
(
    uid       INT NOT NULL,
    tid       INT NOT NULL,
    privilege privilege_enum NOT NULL DEFAULT 'NONE',
    PRIMARY KEY (uid, tid),
    FOREIGN KEY (uid) REFERENCES "user"(uid) ON DELETE CASCADE,
    FOREIGN KEY (tid) REFERENCES template(tid) ON DELETE CASCADE
    );

COMMIT;