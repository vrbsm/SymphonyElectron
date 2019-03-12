import { shallow } from 'enzyme';
import * as React from 'react';
import MoreInfo from '../src/renderer/components/more-info';

describe('more info', () => {
    it('should render correctly', () => {
        const wrapper = shallow(React.createElement(MoreInfo));
        expect(wrapper).toMatchSnapshot();
    });
});
