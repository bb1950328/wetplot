class Wetplot {
    _config = {
        rows: [],
        container_id: "wetplot-container",
        width: 500,
        height: 1000,
    }

    _line_config = {
        "###default###": {
            "type": "line",//also possible: "bar"
            "color": "#000000",
            "name": "?",
        }
    }

    initialize() {
        this._svgElement = document.createElement("svg");
        this._wrapperElement = document.getElementById(this._config["container_id"]);
        this._wrapperElement.appendChild(this._svgElement);
        this._svgElement.style.pointerEvents = "none";
        this._svgElement.setAttribute("width", this._config["width"]);
        this._svgElement.setAttribute("height", this._config["height"]);
        this._svgElement.setAttribute("viewBox", "0 0 " + this._config["width"] + " " + this._config["height"]);
        this._addPanEventListeners();
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
}
