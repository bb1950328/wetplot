class Wetplot {
    _config = {
        rows: [],
        container_id: "wetplot-container",
        width: 500,
        height: 1000,
        time_offset: (+new Date()) - 1000 * 60 * 60 * 24,//in seconds, default is one day before
        seconds_per_pixel: 60,
        caching_enabled: false,
        db_name: "wetplot",
        intervals: ["10min", "1hour", "24hour", "7days", "1month", "1year"],
    }

    _line_config = {
        "###default###": {
            "type": "line",
            "color": "#000000",
            "name": "?",
            "unit": "1",
        }
    }

    _data = null;

    initialize() {
        this._svgElement = document.createElement("svg");
        this._wrapperElement = document.getElementById(this._config["container_id"]);
        this._wrapperElement.appendChild(this._svgElement);
        this._svgElement.style.pointerEvents = "none";
        this._svgElement.setAttribute("width", this._config["width"]);
        this._svgElement.setAttribute("height", this._config["height"]);
        this._svgElement.setAttribute("viewBox", "0 0 " + this._config["width"] + " " + this._config["height"]);
        this._addPanEventListeners();
        this._openDb();
    }

    _openDb(successCallback=(db)=>{}) {
        let request = window.indexedDB.open(this._config["db_name"], 1);
        let time_intervals = this._config["intervals"];
        request.onerror = function (event) {
            console.error(event.target.errorCode);
        }
        request.onsuccess = function (event) {
            let db = event.target.result;
            successCallback(db);
        }
        request.onupgradeneeded = function (event) {
            let db = event.target.result;
            time_intervals.forEach(interval => {
                let objectStore = db.createObjectStore(interval, {keyPath: "Time"});
            });
        }
    }

    _addDataToDb(interval, wetplotData) {
        this._openDb((db) => {
            let transaction = db.transaction([interval], "readwrite");
            let objectStore = transaction.objectStore(interval);
            wetplotData.forEachObject(objectStore.add);
        });
    }

    _getDataFromDb(interval, startTs, endTs) {
        this._openDb((db) => {
            let transaction = db.transaction(interval);
            let objectStore = transaction.objectStore(interval);
            // TODO SELECT * FROM objectStore WHERE startTs <= Time <= endTs
        })
    }

    config(key, value = undefined) {
        if (value !== undefined) {
            this._config[key] = value;
        }
        return this._config[key];
    }

    addLine(lineId) {
        if (lineId === "###default###") {
            throw Error("invalid lineId");
        }
        this._line_config[lineId] = this._line_config["###default###"];
    }

    lineConfig(lineId, property, value = undefined) {
        if (value !== undefined) {
            this._line_config[lineId][property] = value;
        }
        return this._line_config[lineId][property];
    }

    add2dArrayData(heads, values) {
        let newData = new WetplotData(heads, values);
        if (this._data === null) {
            this._data = newData;
        } else {
            this._data = WetplotData.concatenate(this._data, newData);
        }
    }

    _moveViewBoxPixels(deltaPx = 0) {
        if (!deltaPx) {
            return;
        }
        let [x1, y1, x2, y2] = this._svgElement.getAttribute("viewBox").split(" ");
        x1 = Number.parseInt(x1) + deltaPx;
        let newValue = [x1, y1, x2, y2].join(" ");
        this._svgElement.setAttribute("viewBox", newValue);
    }

    _addPanEventListeners() {
        let wrapperElement = this._wrapperElement;
        let shiftViewBox = this._moveViewBoxPixels;
        let _last_mouse_move_x;
        wrapperElement.onwheel = function (event) {
            event.preventDefault();
            console.log(event.deltaX);
            console.log(event.deltaY);
            shiftViewBox(event.deltaX * 10);
            shiftViewBox(event.deltaY * 10);
        }
        wrapperElement.onmousedown = function (event) {
            event.preventDefault();
            _last_mouse_move_x = event.pageX;

            function onMouseMove(event) {
                if (event.pageX <= 2 || event.pageX - 2 > window.innerWidth) {
                    stopDrag();
                    return;
                }
                let delta = _last_mouse_move_x - event.pageX;
                shiftViewBox(delta);
                _last_mouse_move_x = event.pageX;
            }

            document.addEventListener('mousemove', onMouseMove);

            function stopDrag() {
                document.removeEventListener('mousemove', onMouseMove);
                wrapperElement.onmouseup = null;
            }

            wrapperElement.onmouseup = stopDrag;
        };
    }

    _seconds_to_x_coords(seconds) {
        return Math.round(seconds - this._config["time_offset"] / this._config["seconds_per_pixel"]);
    }

    _x_coords_to_seconds(x_coord) {
        return x_coord * this._config["seconds_per_pixel"] + this._config["time_offset"]
    }
}

class WetplotData {
    constructor(heads = [], values = []) {
        this.heads = heads;
        this.values = values;
    }

    heads = []
    values = []

    getValue(rowIndex, columnName) {
        return this.values[rowIndex][this.heads.indexOf(columnName)];
    }

    static concatenate(a, b) {
        let result = new WetplotData();
        let heads_missing_in_a = [];
        let heads_missing_in_b = [];
        a.heads.forEach(head => {
            if (b.heads.indexOf(head) === -1) {
                heads_missing_in_b.push(head);
            }
        });
        b.heads.forEach(head => {
            if (a.heads.indexOf(head) === -1) {
                heads_missing_in_a.push(head);
            }
        });
        this._add_columns(a, heads_missing_in_a);
        this._add_columns(b, heads_missing_in_b);
        let aTime0 = a.getValue(0, "Time");
        let bTime0 = b.getValue(0, "Time");
        let time_cursor = Math.min(aTime0, bTime0);
        let a_cursor = 0;
        let b_cursor = 0;
        while (a_cursor < a.values.length || b_cursor < b.values.length) {
            let diffA = a.getValue(a_cursor, "Time") - time_cursor;
            let diffB = b.getValue(b_cursor, "Time") - time_cursor;
            if (diffA <= diffB) {
                result.values.push();
                //todo  implement or delete
            }
        }
        return result;
    }

    static _add_columns(data, columns, fillvalue = null) {
        let num = columns.length;
        if (num <= 0) {
            return;
        }
        let rowcount = data.values.length;
        for (let row = 0; row < rowcount; row++) {
            for (let i = 0; i < num; i++) {
                data.values[row].push(fillvalue);
            }
        }
        columns.forEach(col => data.heads.push(col));
    }

    forEachObject(callbackFunction) {
        let obj = {};
        this.values.forEach(row => {
            for (let i = 0; i < this.heads.length; i++) {
                obj[this.heads[i]] = row[i];
                callbackFunction(obj);
            }
        });
    }
}
