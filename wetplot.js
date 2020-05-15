const DEFAULT_LINE_CODE = "###default###";

// language=CSS
const WETPLOT_CSS = `
    .xAxisText {
        fill: #000000;
    }

    .linePath {
        fill: none;
    }

    .grid {
        fill: none;
        stroke: #666;
    }
    
    #hoverCursor {
        stroke: #000;
    }
`;

const COLOR_PALETTES = [
    [
        "#ff0000",
        "#ffff00",
        "#00ff00",
        "#00ffff",
        "#0000ff",
        "#ff00ff"
    ], [
        "#ff0000",
        "#ff8000",
        "#ffff00",
        "#80ff00",
        "#00ff00",
        "#00ff80",
        "#00ffff",
        "#0080ff",
        "#0000ff",
        "#8000ff",
        "#ff00ff",
        "#ff0080"
    ],
];

function createSvgElement(tagName = "svg") {
    return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

class Wetplot {
    _config = {
        rows: [],
        container_id: "wetplot-container",
        width: 1000,
        height: 500,
        background_color: "#c7c1a7",
        time_offset: Math.round(((+new Date()) - (1000 * 60 * 60 * 24)) / 1000),//in seconds, default is one day before
        time_lenght: 60 * 60 * 24 * 2, // in seconds
        seconds_per_pixel: 60,
        seconds_per_grid_line: 3600,
        num_horizontal_grid_lines: 20,
        caching_enabled: false,
        db_name: "wetplot",
        intervals: ["10min", "1hour", "24hour", "7days", "1month", "1year"],
        allow_scrolling_to_far: false, // allow user to scroll farther left than time_offset or farther right than time_offset+time_length
        axis_font_size_px: 16,
    }

    _line_config = {
        "###default###": {
            "type": "line",
            "color": "#000000",
            "name": "?",
            "unit": "1",
            "auto_min_max": false,
            "min": -1,
            "max": 25,
        }
    }

    _data = null;

    _x_offset = 0;

    initialize() {
        this._svgElement = createSvgElement("svg");
        this._wrapperElement = document.getElementById(this._config["container_id"]);
        this._wrapperElement.appendChild(this._svgElement);
        //this._wrapperElement.style["width"] = this._config["width"] + "px";
        this._wrapperElement.style["height"] = this._config["height"] + "px";
        this._wrapperElement.style.display = "flex";
        this._svgElement.style.pointerEvents = "none";
        this._svgElement.style.position = "block";
        this._svgElement.style["width"] = this._config["width"] + "px";
        this._svgElement.style["height"] = this._config["height"] + "px";
        this._svgElement.style["background-color"] = this._config["background_color"];
        this._svgElement.setAttribute("width", this._config["width"]);
        this._svgElement.setAttribute("height", this._config["height"]);
        this._svgElement.setAttribute("viewBox", "0 0 " + this._config["width"] + " " + this._config["height"]);
        this._add_style();
        this._addPanEventListeners();
        this._openDb();
        this._rebuildAllLines();
        this._create_y_axis();
        this._draw_x_axis();
        this._draw_horizontal_grid();
        this._createHoverCursor();
    }

    _openDb(successCallback = (db) => {
    }) {
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
            console.log("DB update needed");
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

            function addObj(obj) {
                console.debug("Add " + JSON.stringify(obj));
                objectStore.add(obj);
            }

            function updateObj(obj, previous) {
                if (previous === undefined) {
                    return addObj(obj);
                }
                console.debug("Update " + JSON.stringify(previous));
                Object.assign(previous, obj);
                objectStore.put(previous);
            }

            wetplotData.forEachObject(function (obj) {
                let request = objectStore.get(obj["Time"]);
                request.onsuccess = function (event) {
                    updateObj(obj, request.result);
                };
                request.onerror = function (event) {
                    addObj(obj);
                };
            });
            transaction.onabort = function (event) {
                console.error(event);
            }
        });
    }

    _getDataFromDb(interval, startTs, endTs, callback) {
        this._openDb((db) => {
            let transaction = db.transaction(interval);
            let objectStore = transaction.objectStore(interval);
            let request = objectStore.getAll(IDBKeyRange.bound(startTs, endTs));
            request.onsuccess = function (event) {
                callback(WetplotData.fromObjectArray(request.result));
            }
        });
    }

    _add_style() {
        const style = document.createElement('style');
        style.textContent = WETPLOT_CSS;
        document.head.append(style);
    }

    _draw_x_axis() {
        let group = createSvgElement("g");
        group.setAttribute("id", "xAxisGroup");
        this._svgElement.appendChild(group);

        let gridPath = createSvgElement("path");
        let gridD = "";

        let seconds_step = this._config["seconds_per_grid_line"];
        let seconds_start = this._config["time_offset"];
        let fontSize = this._config["axis_font_size_px"];
        for (let secs = Math.round(seconds_start / seconds_step) * seconds_step; secs < seconds_start + this._config["time_lenght"]; secs += seconds_step) {
            let date = new Date(secs * 1000);//todo timezone issue?
            let x = Math.round(this._seconds_to_x_coords(secs));
            let dateForHuman = date.toLocaleDateString() + " " + date.toLocaleTimeString();
            dateForHuman = dateForHuman.substring(0, dateForHuman.lastIndexOf(":")); // cut off seconds
            let txt = createSvgElement("text");
            txt.innerHTML = dateForHuman;
            txt.setAttribute("x", 0);
            txt.setAttribute("y", fontSize / 4);
            txt.setAttribute("transform", "rotate(90,0,0) translate(" + 10 + " " + -x + ")");
            txt.style.fontSize = fontSize;
            txt.classList.add("xAxisText");
            group.appendChild(txt);

            gridD += "M" + x + " 0 V " + this._config["height"];
        }

        gridPath.setAttribute("d", gridD);
        gridPath.classList.add("grid");
        this._svgElement.appendChild(gridPath);
    }

    _draw_horizontal_grid() {
        let gridD = "";
        let num = this._config["num_horizontal_grid_lines"];
        let dist = this._config["height"] / (num + 1);
        for (let i = 1; i <= num; i++) {
            let y = Math.round(dist * i);
            gridD += "M 0 " + y + " H " + this._getXmax();
        }

        let pathElement = createSvgElement("path");
        pathElement.setAttribute("id", "horizontalGrid");
        pathElement.setAttribute("d", gridD);
        pathElement.classList.add("grid");
        this._svgElement.appendChild(pathElement);
    }

    _rebuildAllLines() {
        this.getAllLineCodes().forEach(lineCode => this._rebuildLine(lineCode));
    }

    _rebuildLine(lineCode) {
        let colNum = this._data.heads.indexOf(lineCode);
        let timeCol = this._data.heads.indexOf("Time");
        const config = this._line_config[lineCode];
        if (config["auto_min_max"]) {
            let [min, max] = this._data.getMinMaxForColumn(colNum);
            config["min"] = min;
            config["max"] = max;
        }
        let path = "M";
        let first = true;
        for (let i = 0; i < this._data.values.length; i++) {
            let x = this._seconds_to_x_coords(this._data.values[i][timeCol]);
            let y = this._value_to_y_coord(lineCode, this._data.values[i][colNum]);
            if (first) {
                first = false;
            } else {
                path += " L";
            }
            path += (" " + Math.round(x) + " " + Math.round(y));
        }
        console.log(path);

        let pathElement = document.getElementById("path" + lineCode);
        if (pathElement === null) {
            pathElement = createSvgElement("path");
            this._svgElement.appendChild(pathElement);
            pathElement.style.stroke = config["color"];
            pathElement.classList.add("linePath");
        }
        pathElement.setAttribute("d", path);
    }

    _create_y_axis() {
        this._yAxisElement = createSvgElement("svg");
        this._yAxisElement.setAttribute("width", "0.01em");
        this._yAxisElement.setAttribute("height", this._config["height"]);
        this._yAxisElement.style.backgroundColor = this._config["background_color"];
        this.getAllLineCodes().forEach(code => this._add_y_axis_for_line_if_needed(code));
        this._wrapperElement.appendChild(this._yAxisElement);
    }

    _createHoverCursor() {
        let g = createSvgElement("g");
        this._svgElement.appendChild(g);
        g.setAttribute("id", "hoverCursor");
        let line = createSvgElement("path");
        g.appendChild(line);
        line.setAttribute("d", "M 0 0 V " + this._config["height"]);

        let catchelement = document.body;

        catchelement.addEventListener("mousemove", (event) => {
            let bbox = this._svgElement.getBoundingClientRect();
            let m = 2;
            let inside =
                bbox.x+m < event.clientX &&
                event.clientX < bbox.right-m &&
                bbox.y+m < event.clientY &&
                event.clientY < bbox.bottom-m;
            if (inside) {
                g.style.display = "inline";
                g.setAttribute("transform", "translate(" + (event.clientX-bbox.x+this._x_offset) + " 0)");
                // todo display time and values as tooltip
            } else {
                g.style.display = "none";
            }
        });
    }

    getAllLineCodes() {
        return Object.getOwnPropertyNames(this._line_config).filter(el => el !== DEFAULT_LINE_CODE);
    }

    _add_y_axis_for_line_if_needed(code) {
        let id = "group" + code;
        if (document.getElementById(id) === null && this._yAxisElement) {
            let fontSize = this._config["axis_font_size_px"];
            let allCodes = this.getAllLineCodes();
            this._yAxisElement.setAttribute("width", allCodes.length * 3 * fontSize);
            let index = allCodes.indexOf(code);

            let g = createSvgElement("g");
            g.setAttribute("id", id);
            g.setAttribute("fill", this._line_config[code]["color"]);
            //g.setAttribute("transform", "translate("+(index*100/allCodes.length)+"% 0)");
            this._yAxisElement.appendChild(g);

            let unit = createSvgElement("text");
            g.appendChild(unit);
            unit.innerHTML = this._line_config[code]["unit"];
            unit.style.fontSize = fontSize + "px";
            unit.setAttribute("y", fontSize);
            unit.setAttribute("x", (index * 3 + 0.5) * fontSize);

            let [minVal, maxVal] = [this._line_config[code]["min"], this._line_config[code]["max"]];
            let minValueStep = (fontSize * 1.2) / (this._config["height"] / (maxVal - minVal));
            let yValueDigitsAfterComma = 0;
            let yValueStep;
            if (minValueStep < 0.5) {
                yValueDigitsAfterComma = 1;
                let stp = minValueStep;
                while (stp < 0.05) {
                    yValueDigitsAfterComma++;
                    stp *= 10;
                }
                if (stp < 0.1) {
                    stp = 0.1;
                } else if (stp < 0.2) {
                    stp = 0.2;
                } else {
                    stp = 0.5;
                }
                stp /= (10 ** (yValueDigitsAfterComma - 1));
                yValueStep = stp;
            } else {
                yValueStep = Math.ceil(minValueStep);
            }

            if (yValueStep === 0) {
                console.warn("something is wrong, i can feel it");
                // prevent endless loop
                return;
            }

            let yMaxCoord = this._config["height"] - fontSize;
            let yValue = Math.floor(minVal);
            while (this._value_to_y_coord(code, yValue) > yMaxCoord) {
                console.log(yValue);
                yValue += yValueStep;
            }
            let yCoord = this._value_to_y_coord(code, yValue);
            let ladderPath = ""
            let yFirstCoord = yCoord;
            let yLastCoord;
            let x = (index + 0.3) * 3 * fontSize;
            while (yCoord > fontSize * 2) {
                yLastCoord = yCoord;
                console.log("val=" + yValue + "\tcoord=" + yCoord.toFixed(2) + "\tvalue_step=" + yValueStep);
                let txt = createSvgElement("text");
                txt.innerHTML = yValue.toFixed(yValueDigitsAfterComma);
                txt.setAttribute("y", yCoord + fontSize * 0.4);
                txt.setAttribute("x", x + fontSize / 3);
                txt.style.fontSize = fontSize;
                g.appendChild(txt);

                ladderPath += "M " + x + " " + yCoord + " h " + (fontSize / -3).toFixed(2) + " ";
                yValue += yValueStep;
                yCoord = this._value_to_y_coord(code, yValue);
            }
            ladderPath += "M " + x + " " + yLastCoord + " V " + yFirstCoord;

            let pathElement = createSvgElement("path");
            pathElement.setAttribute("d", ladderPath);
            pathElement.setAttribute("id", "yLadder" + code);
            pathElement.setAttribute("stroke", this._line_config[code]["color"]);
            g.appendChild(pathElement);
        }
    }

    config(key, value = undefined) {
        if (value !== undefined) {
            this._config[key] = value;
        }
        return this._config[key];
    }

    addLine(lineId) {
        if (lineId === DEFAULT_LINE_CODE) {
            throw Error("invalid lineId");
        }
        this._line_config[lineId] = {...this._line_config[DEFAULT_LINE_CODE]};
        this._add_y_axis_for_line_if_needed(lineId);
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

    usePalette(paletteIndex) {
        let pal = COLOR_PALETTES[paletteIndex];
        let codes = this.getAllLineCodes();
        if (pal) {
            for (let i = 0; i < codes.length; i++) {
                this.lineConfig(codes[i], "color", pal[i % pal.length]);
            }
        }
    }

    _moveViewBoxPixels(deltaPx = 0) {
        if (!deltaPx) {
            return;
        }
        let [x1, y1, x2, y2] = this._svgElement.getAttribute("viewBox").split(" ");
        x1 = Number.parseInt(x1) + deltaPx;
        if (!this._config["allow_scrolling_to_far"]) {
            x1 = Math.max(0, x1);
            let x1max = this._getXmax() - this._config["width"];
            x1 = Math.min(x1, x1max);
        }
        let newValue = [x1, y1, x2, y2].join(" ");
        this._x_offset = x1;
        this._svgElement.setAttribute("viewBox", newValue);
    }

    _getXmax() {
        return this._seconds_to_x_coords(this._config["time_offset"] + this._config["time_lenght"]);
    }

    _addPanEventListeners() {
        let wrapperElement = this._wrapperElement;
        let _last_mouse_move_x;
        wrapperElement.onwheel = (event) => {
            event.preventDefault();
            //console.log(event.deltaX);
            //console.log(event.deltaY);
            this._moveViewBoxPixels(event.deltaX * 10);
            this._moveViewBoxPixels(event.deltaY * 10);
        }
        wrapperElement.onmousedown = (event) => {
            event.preventDefault();
            //console.log("mousedown");
            _last_mouse_move_x = event.pageX;

            let onMouseMove = (event) => {
                if (event.pageX <= 2 || event.pageX - 2 > window.innerWidth) {
                    stopDrag();
                    return;
                }
                let delta = _last_mouse_move_x - event.pageX;
                this._moveViewBoxPixels(delta);
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
        return Math.round((seconds - this._config["time_offset"]) / this._config["seconds_per_pixel"]);
    }

    _x_coords_to_seconds(x_coord) {
        return x_coord * this._config["seconds_per_pixel"] + this._config["time_offset"]
    }

    _value_to_y_coord(lineCode, value) {
        let [min, max] = [this._line_config[lineCode]["min"], this._line_config[lineCode]["max"]];
        let span = max - min;
        return this._config["height"] - this._config["height"] * ((value - min) / span)
    }

    _y_coord_to_value(lineCode, y_coord) {
        let [min, max] = [this._line_config[lineCode]["min"], this._line_config[lineCode]["max"]];
        let span = max - min;
        return (this._config["height"] - y_coord) / this._config["height"] * span + min;
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
            }
            callbackFunction({...obj});  // these weird dots are to clone the object
        });
    }

    static fromObjectArray(objArray = []) {
        let result = new WetplotData();
        objArray.forEach(obj => {
            let row = [];
            Object.getOwnPropertyNames(obj).forEach(key => {
                let colIndex = result.heads.indexOf(key);
                if (colIndex === -1) {
                    colIndex = result.heads.length;
                    result.heads.push(key);
                }
                row[colIndex] = obj[key];
            });
            result.values.push(row);
        });
        result.values.sort((a, b) => (a["Time"] > b["Time"]) ? 1 : ((b["Time"] > a["Time"]) ? -1 : 0));// todo check if its not reversed
        return result;
    }

    getMinMaxForColumn(colIndex = 0) {
        let minVal = undefined;
        let maxVal = undefined;
        for (let i = 0; i < this.values.length; i++) {
            let val = this.values[i][colIndex];
            if (val < minVal || minVal === undefined) {
                minVal = val;
            }
            if (val > maxVal || maxVal === undefined) {
                maxVal = val;
            }
        }
        return [minVal, maxVal];
    }
}
